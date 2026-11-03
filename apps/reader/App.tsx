import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import PdfSkia, { type PdfMeta } from './modules/pdf-skia/src/PdfSkiaModule';

const PAPER = '#FFFCF6';
const INK = '#1E1A16';
const MUTED = '#6B6258';
const BG = '#F7F3EA';

export default function App() {
  const { width, height } = useWindowDimensions();
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);

    (async () => {
      try {
        const info = await PdfSkia.openAsset('test-book.pdf');
        if (cancelled) return;
        setMeta(info);

        const targetWidth = Math.round(pageW * PixelRatio.get());
        const uri = await PdfSkia.renderPage(0, targetWidth);
        if (!cancelled) setPageUri(uri);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageW]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.brand}>Den</Text>
        <Text style={styles.meta}>test-book.pdf</Text>
      </View>

      <View style={styles.stage}>
        <View style={[styles.page, { width: pageW, height: pageH }]}>
          {pageUri ? (
            <Image source={{ uri: pageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          ) : error ? (
            <View style={styles.pageState}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : (
            <View style={styles.pageState}>
              <ActivityIndicator color={MUTED} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.pageNumber}>{meta ? `1 · ${meta.pageCount}` : '1 · —'}</Text>
        <Text style={styles.hint}>tap to turn · pinch to zoom</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
