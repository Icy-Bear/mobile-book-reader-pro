import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Library from './src/Library';
import Reader from './src/Reader';
import type { Book } from './src/books';

let activeBook: Book | null = null;

export default function App() {
  const [book, setBookState] = useState<Book | null>(activeBook);

  const openBook = useCallback((next: Book) => {
    activeBook = next;
    setBookState(next);
  }, []);

  const closeBook = useCallback(() => {
    activeBook = null;
    setBookState(null);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      {book ? (
        <Reader book={book} onClose={closeBook} />
      ) : (
        <Library onOpen={openBook} />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F3EA',
  },
});
