export type BookSource =
  | { kind: 'asset'; value: string }
  | { kind: 'file'; value: string };

export type Book = {
  id: string;
  title: string;
  author: string;
  pages: number;
  tone: string;
  source: BookSource;
};

export const BOOKS: Book[] = [
  {
    id: 'quiet-page',
    title: 'The Quiet Page',
    author: 'Den Press',
    pages: 26,
    tone: '#D9CFC0',
    source: { kind: 'asset', value: 'test-book.pdf' },
  },
];
