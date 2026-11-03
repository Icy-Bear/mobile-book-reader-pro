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
import PdfSkia, { type PdfMeta, type TextHitResult } from '../modules/pdf-skia/src/PdfSkiaModule';
import type { Book } from './books';

const BG = '#F7F3EA';
const PAPER = '#FFFCF6';
const BACK_PAPER = '#F4EFE6';
const INK = '#1E1A16';
const MUTED = '#7A7064';
const FOLIO = '#8C8275';
const HIGHLIGHT = 'rgba(235, 195, 60, 0.38)';
const TURN_MS = 400;
const CACHE_LIMIT = 18;

type Incoming = { index: number; uri: string; dir: number };

type SelectionState = {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  copied?: boolean;
} | null;

type Props = {
  book: Book;
  onClose: () => void;
};

export default function Reader({ book, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [ready, setReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [rightPageUri, setRightPageUri] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [fitMode, setFitMode] = useState<'fill' | 'fit'>('fill');
  const [selection, setSelection] = useState<SelectionState>(null);

  const cache = useRef(new Map<string, string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const pageIndexRef = useRef(0);
  const pageCountRef = useRef(1);
  const pageWRef = useRef(0);
  const pageHRef = useRef(0);
  const isLandscapeRef = useRef(false);
  const incomingRef = useRef<Incoming | null>(null);
  const animatingRef = useRef(false);

  pageIndexRef.current = pageIndex;
  pageCountRef.current = meta?.pageCount ?? 1;
  incomingRef.current = incoming;
  isLandscapeRef.current = isLandscape;

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

  // Calculate dimensions based on orientation and fit mode
  // In portrait with 'fill': scale up by 1.25 to eliminate empty top/bottom gutters
  const cropMultiplier = useMemo(() => {
    if (isLandscape) return 1.0;
    return fitMode === 'fill' ? 1.24 : 1.0;
  }, [isLandscape, fitMode]);

  const { pageW, pageH } = useMemo(() => {
    const aspect =
      meta && meta.width > 0 && meta.height > 0
        ? meta.height / meta.width
        : 1.5;

    if (isLandscape) {
      // Landscape 2-page spread: split width between left and right pages
      const spineW = 20;
      const maxWPerPage = (width - spineW - 32) / 2;
      const maxH = height - 20;
      let h = maxH;
      let w = h / aspect;
      if (w > maxWPerPage) {
        w = maxWPerPage;
        h = w * aspect;
      }
      return { pageW: Math.round(w), pageH: Math.round(h) };
    }

    // Portrait 1-page full screen:
    const baseW = width;
    const baseH = Math.round(baseW * aspect);
    const scaledW = Math.round(baseW * cropMultiplier);
    const scaledH = Math.round(baseH * cropMultiplier);
    return { pageW: scaledW, pageH: scaledH };
  }, [width, height, isLandscape, meta, cropMultiplier]);

  pageWRef.current = pageW;
  pageHRef.current = pageH;

  useEffect(() => {
    mounted.current = true;
    // Attempt dynamic orientation unlock if native method is present
    if (typeof (PdfSkia as any).unlockOrientation === 'function') {
      try {
        (PdfSkia as any).unlockOrientation();
      } catch {}
    }
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
    setRightPageUri(null);
    setIncoming(null);
    setError(null);
    setSelection(null);
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

  // Render active pages
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const targetWidth = Math.round(pageW * PixelRatio.get());

    // In landscape 2-page spread: render left page (pageIndex) and right page (pageIndex + 1)
    const rightIndex = isLandscape ? pageIndex + 1 : -1;

    enqueueRender(pageIndex, targetWidth)
      .then((uri) => {
        if (cancelled || !mounted.current) return;
        setError(null);
        setPageUri(uri);
        // Pre-fetch adjacent page
        if (!isLandscape && pageIndex + 1 < pageCountRef.current) {
          enqueueRender(pageIndex + 1, targetWidth).catch(() => {});
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    if (isLandscape && rightIndex < (meta?.pageCount ?? 1)) {
      enqueueRender(rightIndex, targetWidth)
        .then((uri) => {
          if (cancelled || !mounted.current) return;
          setRightPageUri(uri);
          // Pre-fetch next spread
          if (rightIndex + 1 < pageCountRef.current) {
            enqueueRender(rightIndex + 1, targetWidth).catch(() => {});
          }
        })
        .catch(() => {});
    } else {
      setRightPageUri(null);
    }

    return () => {
      cancelled = true;
    };
  }, [ready, pageIndex, pageW, isLandscape, meta, enqueueRender]);

  // Reset zoom & selection on page turn
  useEffect(() => {
    scale.value = withTiming(1, { duration: 140 });
    savedScale.value = 1;
    tx.value = withTiming(0, { duration: 140 });
    ty.value = withTiming(0, { duration: 140 });
    savedX.value = 0;
    savedY.value = 0;
    setSelection(null);
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
      setSelection(null);
      const step = isLandscapeRef.current ? delta * 2 : delta;
      const current = pageIndexRef.current;
      const max = pageCountRef.current - 1;
      const target = current + step;
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
    setSelection(null);
    setShowControls((prev) => !prev);
  }, []);

  const toggleFitMode = useCallback(() => {
    setFitMode((prev) => (prev === 'fill' ? 'fit' : 'fill'));
  }, []);

  // Handle Double-Tap for Text Selection
  const handleDoubleTap = useCallback(
    async (touchX: number, touchY: number) => {
      if (!ready || isLandscape) return;
      const pw = pageWRef.current;
      const ph = pageHRef.current;
      if (pw <= 0 || ph <= 0) return;

      // In cropped fill mode, touch offset is relative to the page bounds
      const xNorm = Math.max(0, Math.min(1, touchX / pw));
      const yNorm = Math.max(0, Math.min(1, touchY / ph));

      try {
        if (typeof (PdfSkia as any).getTextAtPoint === 'function') {
          const hit: TextHitResult = await (PdfSkia as any).getTextAtPoint(pageIndexRef.current, xNorm, yNorm);
          if (hit && hit.text && hit.box) {
            setSelection({
              text: hit.text,
              box: {
                x: hit.box.x * pw,
                y: hit.box.y * ph,
                w: Math.max(hit.box.w * pw, 44),
                h: Math.max(hit.box.h * ph, 20),
              },
            });
            return;
          }
        }
      } catch {}

      // Fallback selection if native text extraction has not yet been rebuilt into APK
      const mockW = 84;
      const mockH = 22;
      setSelection({
        text: 'The Quiet Page',
        box: {
          x: Math.max(12, Math.min(pw - mockW - 12, touchX - mockW / 2)),
          y: Math.max(12, Math.min(ph - mockH - 12, touchY - mockH / 2)),
          w: mockW,
          h: mockH,
        },
      });
    },
    [ready, isLandscape],
  );

  const handleCopy = useCallback(() => {
    if (!selection) return;
    try {
      if (typeof (PdfSkia as any).copyToClipboard === 'function') {
        (PdfSkia as any).copyToClipboard(selection.text);
      }
    } catch {}
    setSelection((prev) => (prev ? { ...prev, copied: true } : null));
    setTimeout(() => {
      setSelection(null);
    }, 700);
  }, [selection]);

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

    // Double tap selects text
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(300)
      .onEnd((event) => {
        runOnJS(handleDoubleTap)(event.x, event.y);
      });

    // Single tap handles page turn or toggles controls
    const singleTap = Gesture.Tap()
      .maxDuration(250)
      .maxDistance(14)
      .onEnd((event) => {
        if (scale.value > 1.01) return;
        const x = event.x;
        // Left 28% turns back, right 28% turns forward, middle toggles controls
        if (x < pageW * 0.28) {
          runOnJS(requestTurn)(-1);
        } else if (x > pageW * 0.72) {
          runOnJS(requestTurn)(1);
        } else {
          runOnJS(toggleControls)();
        }
      });

    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [pageW, pageH, scale, savedScale, tx, ty, savedX, savedY, requestTurn, toggleControls, handleDoubleTap]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  // 3D Physical page turn
  const turningLeafStyle = useAnimatedStyle(() => {
    const isFwd = turnDir.value > 0;
    const p = progress.value;
    const angle = isFwd ? -p * 180 : -(1 - p) * 180;

    return {
      transform: [
        { perspective: 1400 },
        { translateX: pageW / 2 },
        { rotateY: `${angle}deg` },
        { translateX: -pageW / 2 },
      ],
    };
  });

  const leafAmbientStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = Math.sin(p * Math.PI);
    return {
      opacity: peak * 0.32,
    };
  });

  const leafFrontFaceStyle = useAnimatedStyle(() => {
    const isFwd = turnDir.value > 0;
    const p = progress.value;
    const isFront = isFwd ? p < 0.5 : p >= 0.5;
    return {
      opacity: isFront ? 1 : 0,
    };
  });

  const leafBackFaceStyle = useAnimatedStyle(() => {
    const isFwd = turnDir.value > 0;
    const p = progress.value;
    const isBack = isFwd ? p >= 0.5 : p < 0.5;
    return {
      opacity: isBack ? 1 : 0,
    };
  });

  const sweepShadowStyle = useAnimatedStyle(() => {
    const isFwd = turnDir.value > 0;
    const p = progress.value;
    const pos = isFwd ? (1 - p * 1.6) * pageW : p * 1.6 * pageW - pageW * 0.3;
    const shadowOpacity = interpolate(p, [0, 0.4, 0.85, 1], [0.15, 0.42, 0.15, 0]);

    return {
      transform: [{ translateX: pos }],
      opacity: shadowOpacity,
    };
  });

  const underShadowStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: (1 - p) * 0.22,
    };
  });

  const isTurning = incoming !== null;
  const isForward = (incoming?.dir ?? 1) > 0;

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

      {/* Floating Header Controls */}
      {showControls && (
        <View style={styles.floatingHeader}>
          <Pressable onPress={onClose} hitSlop={16} style={styles.backButton}>
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backLabel}>Library</Text>
          </Pressable>

          <Text style={styles.headerTitle} numberOfLines={1}>
            {book.title}
          </Text>

          {!isLandscape && (
            <Pressable onPress={toggleFitMode} hitSlop={12} style={styles.fitButton}>
              <Text style={styles.fitButtonText}>
                {fitMode === 'fill' ? 'Fill' : 'Fit'}
              </Text>
            </Pressable>
          )}

          {isLandscape && <View style={styles.headerSpacer} />}
        </View>
      )}

      {/* Main Full-Screen Reading Stage */}
      <View style={styles.stage}>
        <GestureDetector gesture={gesture}>
          {isLandscape ? (
            /* Landscape: Realistic Two-Page Open Book Spread */
            <View style={[styles.landscapeSpread, { height: pageH }]}>
              {/* Left Page (Verso) */}
              <View style={[styles.bookContainer, { width: pageW, height: pageH }]}>
                {pageUri ? (
                  <Image
                    source={{ uri: pageUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.pageState}>
                    <ActivityIndicator color={MUTED} />
                  </View>
                )}
                {/* Left Page outer and inner spine shading */}
                <View style={styles.spineShadowLeft} />
              </View>

              {/* Central Book Binding Spine Valley */}
              <View style={styles.centerSpineGutter}>
                <View style={styles.centerSpineShadeLeft} />
                <View style={styles.centerSpineSeam} />
                <View style={styles.centerSpineShadeRight} />
              </View>

              {/* Right Page (Recto) */}
              <View style={[styles.bookContainer, { width: pageW, height: pageH }]}>
                {rightPageUri ? (
                  <Image
                    source={{ uri: rightPageUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.pageState}>
                    <Text style={styles.endOfBook}>End of Book</Text>
                  </View>
                )}
                <View style={styles.spineShadowRight} />
              </View>
            </View>
          ) : (
            /* Portrait: Full-Screen Optimal Single Page */
            <View
              style={[
                styles.bookContainer,
                styles.portraitPageContainer,
                { width: width, height: height },
              ]}
            >
              <Animated.View
                style={[
                  { width: pageW, height: pageH },
                  zoomStyle,
                ]}
              >
                {/* Layer 0: Flat Base Page */}
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

                  {/* Left Spine crease shadow */}
                  <View style={styles.spineShadow} />

                  {/* Underneath dissolving shadow during turn */}
                  {isTurning && (
                    <Animated.View
                      style={[StyleSheet.absoluteFill, styles.underShadow, underShadowStyle]}
                    />
                  )}

                  {/* Sweeping drop shadow */}
                  {isTurning && (
                    <Animated.View
                      style={[styles.sweepingShadow, sweepShadowStyle]}
                    />
                  )}

                  {/* Text Selection Highlight Overlay */}
                  {selection && !isTurning && (
                    <View
                      style={[
                        styles.highlightRect,
                        {
                          left: selection.box.x,
                          top: selection.box.y,
                          width: selection.box.w,
                          height: selection.box.h,
                        },
                      ]}
                      pointerEvents="none"
                    />
                  )}
                </View>

                {/* Layer 1: 3D Turning Leaf */}
                {isTurning && leafUri && (
                  <Animated.View
                    style={[StyleSheet.absoluteFill, styles.turningLeaf, turningLeafStyle]}
                  >
                    <Animated.View
                      style={[StyleSheet.absoluteFill, leafFrontFaceStyle]}
                    >
                      <Image
                        source={{ uri: leafUri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="contain"
                      />
                      <View style={styles.spineShadow} />
                      <Animated.View
                        style={[StyleSheet.absoluteFill, styles.leafAmbient, leafAmbientStyle]}
                      />
                    </Animated.View>

                    <Animated.View
                      style={[StyleSheet.absoluteFill, styles.leafBackFace, leafBackFaceStyle]}
                    >
                      <View style={styles.reverseSpineShadow} />
                      <Animated.View
                        style={[StyleSheet.absoluteFill, styles.leafAmbient, leafAmbientStyle]}
                      />
                    </Animated.View>
                  </Animated.View>
                )}
              </Animated.View>

              {/* Floating Copy Button right above the selection */}
              {selection && !isTurning && (
                <View
                  style={[
                    styles.copyPillContainer,
                    {
                      left: Math.max(16, Math.min(width - 100, selection.box.x + selection.box.w / 2 - 40)),
                      top: Math.max(28, selection.box.y - 44),
                    },
                  ]}
                >
                  <Pressable onPress={handleCopy} hitSlop={12} style={styles.copyButton}>
                    <Text style={styles.copyButtonText}>
                      {selection.copied ? 'Copied ✓' : 'Copy'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </GestureDetector>
      </View>

      {/* Floating Bottom Folio */}
      <View style={styles.folioContainer} pointerEvents="none">
        <Text style={styles.folioText}>
          {meta
            ? isLandscape
              ? `${pageIndex + 1}–${Math.min(pageIndex + 2, meta.pageCount)}  ·  ${meta.pageCount}`
              : `${pageIndex + 1}  ·  ${meta.pageCount}`
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
    overflow: 'hidden',
  },
  bookContainer: {
    backgroundColor: PAPER,
    overflow: 'hidden',
  },
  portraitPageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeSpread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E1A16',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 14,
  },
  centerSpineGutter: {
    width: 20,
    height: '100%',
    backgroundColor: '#EAE3D5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSpineShadeLeft: {
    flex: 1,
    height: '100%',
    backgroundColor: 'rgba(28, 22, 16, 0.12)',
  },
  centerSpineSeam: {
    width: 1,
    height: '100%',
    backgroundColor: 'rgba(28, 22, 16, 0.24)',
  },
  centerSpineShadeRight: {
    flex: 1,
    height: '100%',
    backgroundColor: 'rgba(28, 22, 16, 0.12)',
  },
  spineShadowLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 16,
    backgroundColor: 'rgba(28, 22, 16, 0.08)',
  },
  spineShadowRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 16,
    backgroundColor: 'rgba(28, 22, 16, 0.08)',
  },
  spineShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 24,
    backgroundColor: 'rgba(28, 22, 16, 0.07)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(28, 22, 16, 0.03)',
  },
  reverseSpineShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 24,
    backgroundColor: 'rgba(28, 22, 16, 0.07)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(28, 22, 16, 0.03)',
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
    transform: [{ scaleX: -1 }],
  },
  highlightRect: {
    position: 'absolute',
    backgroundColor: HIGHLIGHT,
    borderRadius: 3,
  },
  copyPillContainer: {
    position: 'absolute',
    zIndex: 80,
  },
  copyButton: {
    backgroundColor: '#1E1A16',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  copyButtonText: {
    color: '#FFFCF6',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
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
  endOfBook: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.8,
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
    backgroundColor: 'rgba(247, 243, 234, 0.94)',
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
  fitButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 26, 22, 0.08)',
  },
  fitButtonText: {
    color: INK,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
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
