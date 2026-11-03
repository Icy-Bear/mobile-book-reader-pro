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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import PdfSkia, { type PdfMeta } from '../modules/pdf-skia/src/PdfSkiaModule';
import type { Book } from './books';

const BG = '#F7F3EA';
const PAPER = '#FFFCF6';
const INK = '#1E1A16';
const MUTED = '#6B6258';
const TURN_MS = 320;
const CACHE_LIMIT = 12;

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

  const progress = useSharedValue(0);
  const turnDir = useSharedValue(1);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const { pageW, pageH } = useMemo(() => {
    const maxW = width - 24;
    const maxH = height - 116;
    let w = maxW;
    let h = w * 1.5;
    if (h > maxH) {
      h = maxH;
      w = h / 1.5;
    }
    return { pageW: w, pageH: h };
  }, [width, height]);

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

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const targetWidth = Math.round(pageW * PixelRatio.get());

    enqueueRender(pageIndex, targetWidth)
      .then((uri) => {
        if (cancelled || !mounted.current) return;
        setError(null);
        setPageUri(uri);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [ready, pageIndex, pageW, enqueueRender]);

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

  useEffect(() => {
    if (!incoming) return;
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: TURN_MS, easing: Easing.inOut(Easing.cubic) },
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
        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          runOnJS(requestTurn)(dx < 0 ? 1 : -1);
        }
      });

    const tap = Gesture.Tap()
      .maxDuration(250)
      .maxDistance(12)
      .onEnd((event) => {
        if (scale.value > 1.01) return;
        runOnJS(requestTurn)(event.x < pageW / 2 ? -1 : 1);
      });

    return Gesture.Simultaneous(pinch, pan, tap);
  }, [pageW, pageH, scale, savedScale, tx, ty, savedX, savedY, requestTurn]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const baseStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -turnDir.value * progress.value * pageW }],
  }));

  const incomingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: turnDir.value * (1 - progress.value) * pageW }],
  }));

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={14} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {book.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.stage}>
        <GestureDetector gesture={gesture}>
          <View style={[styles.page, { width: pageW, height: pageH }]}>
            <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
              <Animated.View style={[StyleSheet.absoluteFill, baseStyle]}>
                {pageUri ? (
                  <Image
                    source={{ uri: pageUri }}
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
              </Animated.View>

              {incoming ? (
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.incomingPage, incomingStyle]}
                >
                  <Image
                    source={{ uri: incoming.uri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                </Animated.View>
              ) : null}
            </Animated.View>
          </View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.pageNumber}>
          {meta ? `${pageIndex + 1} / ${meta.pageCount}` : '—'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 18,
    paddingBottom: 16,
  },
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: INK,
    fontSize: 30,
    lineHeight: 32,
    marginTop: -2,
  },
  title: {
    flex: 1,
    color: INK,
    fontSize: 13,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 36,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  page: {
    backgroundColor: PAPER,
    borderRadius: 4,
    elevation: 8,
    shadowColor: '#1E1A16',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    overflow: 'hidden',
  },
  incomingPage: {
    backgroundColor: PAPER,
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
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  footer: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumber: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
});
