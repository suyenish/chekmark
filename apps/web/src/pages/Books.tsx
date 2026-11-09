import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type Book, messageOf, type PageInfo, type PageStatus, useApi } from '../api';

/** The reader's books. Creating one is the first step for a new reader. */
export function Books() {
  const api = useApi();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listBooks().then(setBooks, (e: unknown) => setError(messageOf(e)));
  }, [api]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const book = await api.createBook(title.trim());
      setBooks((list) => [{ ...book, pageCount: 0 }, ...(list ?? [])]);
      setTitle('');
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <>
      <h1>Your books</h1>
      {books && books.length === 0 && <p className="lede">Add the book you are reading to start.</p>}
      {books && books.length > 0 && (
        <ul className="rows">
          {books.map((book) => (
            <li key={book.id}>
              <Link className="row" to={`/books/${book.id}`}>
                <span className="title" lang="ko">
                  {book.title}
                </span>
                <span className="meta">
                  {book.pageCount ?? 0} page{book.pageCount === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <h2>Add a book</h2>
      <form className="inline-form" onSubmit={add}>
        <label className="field">
          <span>Title</span>
          <input type="text" lang="ko" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="submit" className="button" disabled={!title.trim()}>
          Add book
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const STATUS_TEXT: Record<PageStatus, string> = {
  UPLOADED: 'Waiting to be read',
  DETECTING: 'Reading marks',
  AWAITING_CHECK: 'Ready for your check',
  EXPLAINING: 'Writing explanations',
  DONE: 'Finished',
  FAILED: 'Needs attention',
};

/** One book: its pages, and the way to add the next one. */
export function BookPages() {
  const api = useApi();
  const { bookId = '' } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<PageInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getBook(bookId), api.listPages(bookId)]).then(
      ([b, p]) => {
        setBook(b);
        setPages(p);
      },
      (e: unknown) => setError(messageOf(e)),
    );
  }, [api, bookId]);

  if (error) return <p className="error">{error}</p>;
  if (!book || !pages) return <p className="note">Loading…</p>;

  return (
    <>
      <p>
        <Link to="/">All books</Link>
      </p>
      <h1 className="korean" lang="ko">
        {book.title}
      </h1>
      {pages.length === 0 ? (
        <p className="lede">Mark a page with a pencil, then take a photo of it.</p>
      ) : (
        <ul className="rows">
          {pages.map((page) => (
            <li key={page.id}>
              <Link className="row" to={`/pages/${page.id}`}>
                <span className="title">Page {page.pageNumber}</span>
                <span className="meta">{STATUS_TEXT[page.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="action-bar">
        <div>
          <Link className="button primary wide" to={`/books/${book.id}/capture`}>
            Add a page
          </Link>
        </div>
      </div>
    </>
  );
}
