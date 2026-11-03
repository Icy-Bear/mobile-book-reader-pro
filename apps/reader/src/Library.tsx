import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BOOKS, type Book } from './books';

const BG = '#F7F3EA';
const PAPER = '#FFFCF6';
const INK = '#1E1A16';
const MUTED = '#6B6258';

type Props = {
  onOpen: (book: Book) => void;
};

export default function Library({ onOpen }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>Den</Text>
        <Text style={styles.meta}>
          {BOOKS.length === 1 ? '1 book' : `${BOOKS.length} books`} · offline
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>YOUR LIBRARY</Text>
        <Text style={styles.title}>Read slowly.</Text>

        {BOOKS.map((book) => (
          <Pressable
            key={book.id}
            onPress={() => onOpen(book)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={[styles.cover, { backgroundColor: book.tone }]}>
              <Text style={styles.coverPress}>DEN PRESS</Text>
              <Text style={styles.coverTitle} numberOfLines={3}>
                {book.title}
              </Text>
              <View style={styles.coverRule} />
              <Text style={styles.coverAuthor} numberOfLines={1}>
                {book.author}
              </Text>
            </View>

            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {book.title}
              </Text>
              <Text style={styles.rowAuthor}>{book.author}</Text>
              <Text style={styles.rowPages}>{book.pages} pages</Text>
            </View>

            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        <Text style={styles.footnote}>Tap a book to open it.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 54,
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
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  meta: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 44,
  },
  eyebrow: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  title: {
    color: INK,
    fontFamily: 'serif',
    fontSize: 32,
    lineHeight: 38,
    marginBottom: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PAPER,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    elevation: 4,
    shadowColor: '#1E1A16',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  rowPressed: {
    opacity: 0.72,
  },
  cover: {
    width: 76,
    height: 110,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(30,26,22,0.12)',
    paddingHorizontal: 9,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  coverPress: {
    color: 'rgba(30,26,22,0.55)',
    fontSize: 6,
    letterSpacing: 1.1,
  },
  coverTitle: {
    color: INK,
    fontFamily: 'serif',
    fontSize: 13,
    lineHeight: 16,
  },
  coverRule: {
    height: 1,
    backgroundColor: 'rgba(30,26,22,0.28)',
    width: '42%',
  },
  coverAuthor: {
    color: 'rgba(30,26,22,0.55)',
    fontSize: 6,
    letterSpacing: 0.4,
  },
  rowText: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  rowTitle: {
    color: INK,
    fontFamily: 'serif',
    fontSize: 20,
    lineHeight: 24,
  },
  rowAuthor: {
    color: MUTED,
    fontSize: 12,
    marginTop: 5,
  },
  rowPages: {
    color: MUTED,
    fontSize: 11,
    marginTop: 10,
    letterSpacing: 0.2,
  },
  chevron: {
    color: MUTED,
    fontSize: 26,
    marginRight: 2,
  },
  footnote: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: 0.2,
  },
});
