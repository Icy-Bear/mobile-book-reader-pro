import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import PdfSkia, { type PdfMeta } from '../modules/pdf-skia/src/PdfSkiaModule';
import type { Book } from './books';

const BG = '#F7F3EA';
const PAPER = '#FFFCF6';
const BACK_PAPER = '#F4EFE6';
const INK = '#1E1A16';
const MUTED = '#7A7064';
const FOLIO = '#8C8275';
const TURN_MS = 400;
const CACHE_LIMIT = 14;

type Incoming = { index: number; uri: string; dir: number };

type Props = {
  book: Book;
  onClose: () => void;
};

export default function Reader({ book, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [ready, setReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);

  const cache = useRef(new Map<string, string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const pageIndexRef = useRef(0);
  const pageCountRef = useRef(1);
  const pageWRef = useRef(0);
  const incomingRef = useRef<Incoming | null>(null);
  const animatingRef = useRef(false);

  pageIndexRef.current = pageIndex;
  pageCountRef.current = meta?.pageCount ?? 1;
  incomingRef.current = incoming;

  // Turn animation values
  const progress = useSharedValue(0);
  const turnDir = useSharedValue(1); // 1 = next, -1 = prev

  // Zoom / pan values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // Full-screen optimal dimensions: edge-to-edge width, natural PDF aspect ratio
  const { pageW, pageH } = useMemo(() => {
    const w = width; // Fill 100% of device screen width
    const aspect =
      meta && meta.width > 0 && meta.height > 0
        ? meta.height / meta.width
        : 1.5;
    const naturalH = Math.round(w * aspect);
    // Never exceed screen height, but use full width
    const h = Math.min(height, naturalH);
    return { pageW: w, pageH: h };
  }, [width, height, meta]);

  pageWRef.current = pageW;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setMeta(null);
    setPageIndex(0);
    setPageUri(null);
    setIncoming(null);
    setError(null);
    animatingRef.current = false;
    incomingRef.current = null;
    progress.value = 0;
    cache.current.clear();
    chain.current = Promise.resolve();

    (async () => {
      try {
        const info =
          book.source.kind === 'asset'
            ? await PdfSkia.openAsset(book.source.value)
            : await PdfSkia.open(book.source.value);
        if (cancelled) return;
        setMeta(info);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        PdfSkia.close();
      } catch {}
    };
  }, [book, progress]);

  const enqueueRender = useCallback((index: number, targetWidth: number) => {
    const key = `${index}:${targetWidth}`;
    const hit = cache.current.get(key);
    if (hit) return Promise.resolve(hit);

    const task = chain.current.then(async () => {
      const again = cache.current.get(key);
      if (again) return again;
      const uri = await PdfSkia.renderPage(index, targetWidth);
      cache.current.set(key, uri);
      if (cache.current.size > CACHE_LIMIT) {
        const oldest = cache.current.keys().next().value;
        if (oldest) cache.current.delete(oldest);
      }
      return uri;
    });

    chain.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, []);

  // Render current page
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const targetWidth = Math.round(pageW * PixelRatio.get());

    enqueueRender(pageIndex, targetWidth)
      .then((uri) => {
        if (cancelled || !mounted.current) return;
        setError(null);
        setPageUri(uri);
        // Pre-fetch adjacent next page for instant turning
        if (pageIndex + 1 < pageCountRef.current) {
          enqueueRender(pageIndex + 1, targetWidth).catch(() => {});
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [ready, pageIndex, pageW, enqueueRender]);

  // Reset zoom on page turn
  useEffect(() => {
    scale.value = withTiming(1, { duration: 140 });
    savedScale.value = 1;
    tx.value = withTiming(0, { duration: 140 });
    ty.value = withTiming(0, { duration: 140 });
    savedX.value = 0;
    savedY.value = 0;
  }, [pageIndex, scale, savedScale, tx, ty, savedX, savedY]);

  const commitIncoming = useCallback(() => {
    const inc = incomingRef.current;
    if (!inc) return;
    setPageUri(inc.uri);
    setPageIndex(inc.index);
    setIncoming(null);
    animatingRef.current = false;
    progress.value = 0;
  }, [progress]);

  // Run the 3D physical page turn animation
  useEffect(() => {
    if (!incoming) return;
    progress.value = 0;
    progress.value = withTiming(
      1,
      {
        duration: TURN_MS,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      },
      (finished) => {
        if (finished) runOnJS(commitIncoming)();
      },
    );
  }, [incoming, progress, commitIncoming]);

  const requestTurn = useCallback(
    (delta: number) => {
      if (!ready || animatingRef.current || incomingRef.current) return;
      const current = pageIndexRef.current;
      const max = pageCountRef.current - 1;
      const target = current + delta;
      if (target < 0 || target > max) return;

      animatingRef.current = true;
      turnDir.value = delta;
      const targetWidth = Math.round(pageWRef.current * PixelRatio.get());

      enqueueRender(target, targetWidth)
        .then((uri) => {
          if (!mounted.current) {
            animatingRef.current = false;
            return;
          }
          setIncoming({ index: target, uri, dir: delta });
        })
        .catch((e) => {
          animatingRef.current = false;
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [ready, enqueueRender, turnDir],
  );

  const toggleControls = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((event) => {
        scale.value = Math.min(4, Math.max(1, savedScale.value * event.scale));
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (scale.value <= 1.01) {
          scale.value = withTiming(1);
          savedScale.value = 1;
          tx.value = withTiming(0);
          ty.value = withTiming(0);
          savedX.value = 0;
          savedY.value = 0;
        }
      });

    const pan = Gesture.Pan()
      .onUpdate((event) => {
        if (scale.value <= 1.01) return;
        const maxX = (pageW * (scale.value - 1)) / 2;
        const maxY = (pageH * (scale.value - 1)) / 2;
        tx.value = Math.min(maxX, Math.max(-maxX, savedX.value + event.translationX));
        ty.value = Math.min(maxY, Math.max(-maxY, savedY.value + event.translationY));
      })
      .onEnd((event) => {
        if (scale.value > 1.01) {
          savedX.value = tx.value;
          savedY.value = ty.value;
          return;
        }
        const dx = event.translationX;
        const dy = event.translationY;
        if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          runOnJS(requestTurn)(dx < 0 ? 1 : -1);
        }
      });

    const tap = Gesture.Tap()
      .maxDuration(250)
      .maxDistance(14)
      .onEnd((event) => {
        if (scale.value > 1.01) return;
        const x = event.x;
        // Left 30% turns back, right 30% turns forward, middle 40% toggles controls
        if (x < pageW * 0.3) {
          runOnJS(requestTurn)(-1);
        } else if (x > pageW * 0.7) {
          runOnJS(requestTurn)(1);
        } else {
          runOnJS(toggleControls)();
        }
      });

    return Gesture.Simultaneous(pinch, pan, tap);
  }, [pageW, pageH, scale, savedScale, tx, ty, savedX, savedY, requestTurn, toggleControls]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  // 3D Physical page turn: Top leaf lifting and swinging around the left spine
  // Forward (dir=1): Current page lifts from right edge and rotates 0 -> -180 deg
  // Backward (dir=-1): Incoming page swings from left (-180 -> 0 deg) and settles flat
  const turningLeafStyle = useAnimatedStyle(() => {
    const isForward = turnDir.value > 0;
    const p = progress.value;
    const angle = isForward ? -p * 180 : -(1 - p) * 180;

    return {
      transform: [
        { perspective: 1400 },
        { translateX: pageW / 2 },
        { rotateY: `${angle}deg` },
        { translateX: -pageW / 2 },
      ],
    };
  });

  // Dynamic ambient shadow on turning leaf as it angles into the light
  const leafAmbientStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Peak shadow around 60-80 degrees (p ~ 0.35-0.45)
    const peak = Math.sin(p * Math.PI);
    return {
      opacity: peak * 0.32,
    };
  });

  // Front face of leaf is visible from 0 to 90 degrees
  const leafFrontFaceStyle = useAnimatedStyle(() => {
    const isForward = turnDir.value > 0;
    const p = progress.value;
    const isFront = isForward ? p < 0.5 : p >= 0.5;
    return {
      opacity: isFront ? 1 : 0,
    };
  });

  // Back face of leaf is visible from 90 to 180 degrees
  const leafBackFaceStyle = useAnimatedStyle(() => {
    const isForward = turnDir.value > 0;
    const p = progress.value;
    const isBack = isForward ? p >= 0.5 : p < 0.5;
    return {
      opacity: isBack ? 1 : 0,
    };
  });

  // Moving drop shadow cast by lifting page edge onto the page underneath
  const sweepShadowStyle = useAnimatedStyle(() => {
    const isForward = turnDir.value > 0;
    const p = progress.value;
    // Shadow position moves across from right to left (forward) or left to right (backward)
    const pos = isForward ? (1 - p * 1.6) * pageW : p * 1.6 * pageW - pageW * 0.3;
    const shadowOpacity = interpolate(p, [0, 0.4, 0.85, 1], [0.15, 0.42, 0.15, 0]);

    return {
      transform: [{ translateX: pos }],
      opacity: shadowOpacity,
    };
  });

  // Underneath page shadow that dissolves as the top page lifts off
  const underShadowStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: (1 - p) * 0.22,
    };
  });

  // Determine which page is on bottom and which is the lifting leaf
  const isTurning = incoming !== null;
  const isForward = (incoming?.dir ?? 1) > 0;

  // For forward turn: base is incoming (page N+1), turning leaf is current (page N)
  // For backward turn: base is current (page N), turning leaf is incoming (page N-1)
  const baseUri = isTurning
    ? isForward
      ? incoming.uri
      : pageUri
    : pageUri;

  const leafUri = isTurning
    ? isForward
      ? pageUri
      : incoming.uri
    : null;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* Floating Top Controls (Toggled by center tap) */}
      {showControls && (
        <View style={styles.floatingHeader}>
          <Pressable onPress={onClose} hitSlop={16} style={styles.backButton}>
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backLabel}>Library</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {book.title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>
      )}

      {/* Main Full-Screen Stage */}
      <View style={styles.stage}>
        <GestureDetector gesture={gesture}>
          <View style={[styles.bookContainer, { width: pageW, height: pageH }]}>
            <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
              {/* Layer 0: Flat Base Page (Revealed underneath) */}
              <View style={StyleSheet.absoluteFill}>
                {baseUri ? (
                  <Image
                    source={{ uri: baseUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                ) : error ? (
                  <View style={styles.pageState}>
                    <Text style={styles.error}>{error}</Text>
                  </View>
                ) : (
                  <View style={styles.pageState}>
                    <ActivityIndicator color={MUTED} />
                  </View>
                )}

                {/* Spine crease shadow along the left edge */}
                <View style={styles.spineShadow} />

                {/* Underneath shadow dissolving during turn */}
                {isTurning && (
                  <Animated.View
                    style={[StyleSheet.absoluteFill, styles.underShadow, underShadowStyle]}
                  />
                )}

                {/* Moving drop shadow cast by lifting leaf edge */}
                {isTurning && (
                  <Animated.View
                    style={[styles.sweepingShadow, sweepShadowStyle]}
                  />
                )}
              </View>

              {/* Layer 1: 3D Turning Leaf (Lifts and rotates) */}
              {isTurning && leafUri && (
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.turningLeaf, turningLeafStyle]}
                >
                  {/* Front face of leaf (Current page lifting) */}
                  <Animated.View
                    style={[StyleSheet.absoluteFill, leafFrontFaceStyle]}
                  >
                    <Image
                      source={{ uri: leafUri }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="contain"
                    />
                    <View style={styles.spineShadow} />
                    {/* Ambient light variation as page rotates */}
                    <Animated.View
                      style={[StyleSheet.absoluteFill, styles.leafAmbient, leafAmbientStyle]}
                    />
                  </Animated.View>

                  {/* Back face of leaf (Warm physical paper backing) */}
                  <Animated.View
                    style={[StyleSheet.absoluteFill, styles.leafBackFace, leafBackFaceStyle]}
                  >
                    {/* Reverse spine shadow on back face */}
                    <View style={styles.reverseSpineShadow} />
                    {/* Ambient light on back face */}
                    <Animated.View
                      style={[StyleSheet.absoluteFill, styles.leafAmbient, leafAmbientStyle]}
                    />
                  </Animated.View>
                </Animated.View>
              )}
            </Animated.View>
          </View>
        </GestureDetector>
      </View>

      {/* Floating Bottom Folio (Page Number) */}
      <View style={styles.folioContainer} pointerEvents="none">
        <Text style={styles.folioText}>
          {meta
            ? `${pageIndex + 1}  ·  ${meta.pageCount}`
            : '—'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    position: 'relative',
  },
  stage: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookContainer: {
    backgroundColor: PAPER,
    overflow: 'hidden',
  },
  spineShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 22,
    backgroundColor: 'rgba(28, 22, 16, 0.07)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(28, 22, 16, 0.04)',
  },
  reverseSpineShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 22,
    backgroundColor: 'rgba(28, 22, 16, 0.07)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(28, 22, 16, 0.04)',
  },
  sweepingShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 44,
    backgroundColor: 'rgba(24, 18, 12, 0.22)',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 14,
  },
  underShadow: {
    backgroundColor: 'rgba(20, 16, 12, 0.2)',
  },
  turningLeaf: {
    backgroundColor: PAPER,
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 16,
  },
  leafAmbient: {
    backgroundColor: '#000',
  },
  leafBackFace: {
    backgroundColor: BACK_PAPER,
    transform: [{ scaleX: -1 }], // mirrored for back face
  },
  pageState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  error: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  floatingHeader: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    height: 44,
    zIndex: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(247, 243, 234, 0.92)',
    shadowColor: '#1E1A16',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  backChevron: {
    color: INK,
    fontSize: 26,
    lineHeight: 28,
    marginTop: -2,
    marginRight: 4,
  },
  backLabel: {
    color: INK,
    fontSize: 13,
    fontWeight: '500',
  },
  headerTitle: {
    flex: 1,
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  headerSpacer: {
    width: 60,
  },
  folioContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 40,
  },
  folioText: {
    color: FOLIO,
    fontSize: 11,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
    opacity: 0.85,
  },
});
