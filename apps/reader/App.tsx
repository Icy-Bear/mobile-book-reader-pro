import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import PdfSkia, { type PdfMeta } from './modules/pdf-skia/src/PdfSkiaModule';

const PAPER = '#FFFCF6';
const INK = '#1E1A16';
const MUTED = '#6B6258';
const BG = '#F7F3EA';

export default function App() {
  const { width, height } = useWindowDimensions();
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [ready, setReady] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cache = useRef(new Map<string, string>());
  const renderChain = useRef<Promise<void>>(Promise.resolve());
  const direction = useRef(1);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const slide = useSharedValue(0);

  const { pageW, pageH } = useMemo(() => {
    const maxW = Math.min(width - 32, 430);
    const maxH = height - 168;
    let w = maxW;
    let h = w * 1.5;
    if (h > maxH) {
      h = maxH;
      w = h / 1.5;
    }
    return { pageW: w, pageH: h };
  }, [width, height]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await PdfSkia.openAsset('test-book.pdf');
        if (cancelled) return;
        setMeta(info);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const targetWidth = Math.round(pageW * PixelRatio.get());
    const key = `${pageIndex}:${targetWidth}`;

    renderChain.current = renderChain.current.then(async () => {
      if (cancelled) return;
      try {
        let uri = cache.current.get(key);
        if (!uri) {
          uri = await PdfSkia.renderPage(pageIndex, targetWidth);
          if (cancelled) return;
          cache.current.set(key, uri);
        }
        if (!cancelled) {
          setError(null);
          setPageUri(uri);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, pageIndex, pageW]);

  useEffect(() => {
    if (!pageUri) return;
    opacity.value = 0;
    slide.value = direction.current * 26;
    opacity.value = withTiming(1, { duration: 200 });
    slide.value = withTiming(0, { duration: 240 });
  }, [pageUri, opacity, slide]);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 140 });
    savedScale.value = 1;
    tx.value = withTiming(0, { duration: 140 });
    ty.value = withTiming(0, { duration: 140 });
    savedX.value = 0;
    savedY.value = 0;
  }, [pageIndex, scale, savedScale, tx, ty, savedX, savedY]);

  const turnTo = (target: number) => {
    const max = (meta?.pageCount ?? 1) - 1;
    const next = Math.max(0, Math.min(max, target));
    if (next === pageIndex) return;
    direction.current = next > pageIndex ? 1 : -1;
    setPageIndex(next);
  };

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
    .onEnd(() => {
      savedX.value = tx.value;
      savedY.value = ty.value;
    });

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((event) => {
      if (scale.value > 1.01) return;
      runOnJS(turnTo)(event.x < pageW / 2 ? pageIndex - 1 : pageIndex + 1);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, tap);

  const pageStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value + slide.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <StatusBar style="dark" />

        <View style={styles.header}>
          <Text style={styles.brand}>Den</Text>
          <Text style={styles.meta}>test-book.pdf</Text>
        </View>

        <GestureDetector gesture={gesture}>
          <View style={styles.stage}>
            <View style={[styles.page, { width: pageW, height: pageH }]}>
              <Animated.View style={[StyleSheet.absoluteFill, pageStyle]}>
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
            </View>
          </View>
        </GestureDetector>

        <View style={styles.footer}>
          <Text style={styles.pageNumber}>
            {meta ? `${pageIndex + 1} · ${meta.pageCount}` : '—'}
          </Text>
          <Text style={styles.hint}>tap to turn · pinch to zoom</Text>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 54,
    paddingBottom: 28,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  brand: {
    color: INK,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  meta: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    backgroundColor: PAPER,
    borderRadius: 6,
    elevation: 12,
    shadowColor: '#1E1A16',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    overflow: 'hidden',
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
    paddingHorizontal: 22,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageNumber: {
    color: MUTED,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
