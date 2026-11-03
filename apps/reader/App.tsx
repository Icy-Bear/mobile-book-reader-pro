import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas, Rect } from '@shopify/react-native-skia';

const PAPER = '#FFFCF6';
const INK = '#1E1A16';
const MUTED = '#6B6258';
const BG = '#F7F3EA';

function buildLines(pageW: number, pageH: number) {
  const pad = 26;
  const top = 92;
  const bottom = pageH - 58;
  const lineH = 4;
  const gap = 11;
  const widths = [0.97, 0.92, 0.96, 0.88, 0.94, 0.71, 0.95, 0.9, 0.98, 0.84, 0.93, 0.68];
  const lines: { x: number; y: number; width: number }[] = [];
  let y = top;
  let i = 0;
  while (y + lineH < bottom) {
    const fraction = widths[i % widths.length];
    lines.push({ x: pad, y, width: (pageW - pad * 2) * fraction });
    y += gap;
    i += 1;
    if (i % 7 === 0) y += 10;
  }
  return lines;
}

export default function App() {
  const { width, height } = useWindowDimensions();

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

  const lines = useMemo(() => buildLines(pageW, pageH), [pageW, pageH]);
  const pad = 26;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.brand}>Den</Text>
        <Text style={styles.meta}>test-book.pdf</Text>
      </View>

      <View style={styles.stage}>
        <View style={[styles.page, { width: pageW, height: pageH }]}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Rect x={pad} y={pad} width={pageW - pad * 2} height={1} color="rgba(30,26,22,0.12)" />

            <Rect x={pad} y={pad + 20} width={(pageW - pad * 2) * 0.54} height={9} color="rgba(30,26,22,0.5)" />
            <Rect x={pad} y={pad + 38} width={(pageW - pad * 2) * 0.32} height={5} color="rgba(107,98,88,0.5)" />

            {lines.map((line, index) => (
              <Rect
                key={index}
                x={line.x}
                y={line.y}
                width={line.width}
                height={4}
                color="rgba(30,26,22,0.14)"
              />
            ))}

            <Rect
              x={pad}
              y={pageH - pad}
              width={pageW - pad * 2}
              height={1}
              color="rgba(30,26,22,0.1)"
            />
          </Canvas>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.pageNumber}>1 · 26</Text>
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
