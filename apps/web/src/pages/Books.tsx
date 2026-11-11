import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { StackItem } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useParams } from 'react-router';
import { type Book, messageOf, type PageInfo, type PageStatus, useApi } from '../api';
import { ErrorNote } from '../ui';

const Loading = () => (
  <VStack gap={2} aria-label="Loading">
    <Skeleton height={56} index={0} />
    <Skeleton height={56} index={1} />
    <Skeleton height={56} index={2} />
  </VStack>
);

/** The reader's books. Creating one is the first step for a new reader. */
export function Books() {
  const api = useApi();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listBooks().then(setBooks, (e: unknown) => setError(messageOf(e)));
  }, [api]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const book = await api.createBook(title.trim());
      setBooks((list) => [{ ...book, pageCount: 0 }, ...(list ?? [])]);
      setTitle('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={6}>
      <VStack gap={2}>
        <Heading level={1}>Your books</Heading>
        {books?.length === 0 && (
          <Text type="large" color="secondary" as="p">
            Add the book you are reading. Then mark a page with a pencil and take a photo of it.
          </Text>
        )}
      </VStack>

      {!books && !error && <Loading />}
      {books && books.length > 0 && (
        <List hasDividers edge="flush" density="spacious">
          {books.map((book) => (
            <ListItem
              key={book.id}
              href={`/books/${book.id}`}
              label={
                <Text type="large">
                  <span className="korean" lang="ko">
                    {book.title}
                  </span>
                </Text>
              }
              description={`${book.pageCount ?? 0} page${book.pageCount === 1 ? '' : 's'}`}
            />
          ))}
        </List>
      )}

      <form onSubmit={add}>
        <VStack gap={3}>
          <Heading level={2}>Add a book</Heading>
          <HStack gap={2} vAlign="end">
            <StackItem size="fill">
              <TextInput label="Title" description="As printed on the cover." value={title} onChange={setTitle} width="100%" />
            </StackItem>
            <StackItem size="static">
              <Button label="Add book" type="submit" isDisabled={!title.trim()} isLoading={busy} />
            </StackItem>
          </HStack>
        </VStack>
      </form>
      <ErrorNote message={error} />
    </VStack>
  );
}

const STATUS: Record<PageStatus, { text: string; dot: 'neutral' | 'warning' | 'success' | 'error' | 'accent' }> = {
  UPLOADED: { text: 'Waiting to be read', dot: 'neutral' },
  DETECTING: { text: 'Reading marks', dot: 'neutral' },
  AWAITING_CHECK: { text: 'Ready for your check', dot: 'warning' },
  EXPLAINING: { text: 'Writing explanations', dot: 'neutral' },
  DONE: { text: 'Finished', dot: 'success' },
  FAILED: { text: 'Needs attention', dot: 'error' },
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

  if (error) {
    return (
      <VStack gap={3} hAlign="start">
        <ErrorNote message={error} />
        <Link href="/" isStandalone>
          Back to your books
        </Link>
      </VStack>
    );
  }
  if (!book || !pages) return <Loading />;

  return (
    <VStack gap={5}>
      <VStack gap={2} hAlign="start">
        <Link href="/" isStandalone>
          All books
        </Link>
        <Heading level={1}>
          <span className="korean" lang="ko">
            {book.title}
          </span>
        </Heading>
      </VStack>
      {pages.length === 0 ? (
        <Text type="large" color="secondary" as="p">
          No pages yet. Mark a page with a pencil, then add a photo of it.
        </Text>
      ) : (
        <List hasDividers edge="flush" density="spacious">
          {pages.map((page) => (
            <ListItem
              key={page.id}
              href={`/pages/${page.id}`}
              label={`Page ${page.pageNumber}`}
              description={STATUS[page.status].text}
              endContent={<StatusDot variant={STATUS[page.status].dot} label={STATUS[page.status].text} />}
            />
          ))}
        </List>
      )}
      <div className="action-bar">
        <Button label="Add a page" variant="primary" size="lg" width="100%" href={`/books/${book.id}/capture`} />
      </div>
    </VStack>
  );
}
