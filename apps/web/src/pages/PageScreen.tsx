import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { ApiError, messageOf, type PageInfo, type PageStatus, useApi } from '../api';
import { ErrorNote } from '../ui';
import { MarkCheck } from './MarkCheck';
import { Results } from './Results';

/** While the worker is busy, the page is asked for again every 2 seconds. */
export const POLL_MS = 2000;
const WORKING: PageStatus[] = ['UPLOADED', 'DETECTING', 'EXPLAINING'];

/** After a failed request, wait longer each time, up to 30 seconds. */
const MAX_RETRY_MS = 30_000;

/** Worth asking again: the phone lost signal (0) or the server is restarting (5xx). Not: the page is gone, or the session ended. */
const isTemporary = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500;

/** One page from upload to finish: waiting, Mark check, explaining, done or failed. */
export function PageScreen({ pageId, pollMs = POLL_MS }: { pageId: string; pollMs?: number }) {
  const api = useApi();
  const [page, setPage] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const load = async () => {
      try {
        const next = await api.getPage(pageId);
        if (stopped) return;
        failures = 0;
        setError(null);
        setPage(next);
        if (WORKING.includes(next.status)) timer = setTimeout(load, pollMs);
      } catch (e) {
        if (stopped) return;
        if (!isTemporary(e)) {
          setMissing(e instanceof ApiError && e.status === 404);
          setError(messageOf(e));
          return; // asking again would not help
        }
        // A phone can lose signal for a moment, or the server can be restarting: say so and keep trying.
        failures++;
        setError(messageOf(e));
        timer = setTimeout(load, Math.min(pollMs * 2 ** failures, MAX_RETRY_MS));
      }
    };
    // Start again whenever the page goes back to a working status (after Confirm or Retry).
    if (!page || WORKING.includes(page.status)) void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the status changes
  }, [api, pageId, pollMs, page?.status]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      setPage(await api.retry(pageId));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <VStack gap={3} hAlign="start">
        <Heading level={1}>Page not found</Heading>
        <Text type="large" color="secondary" as="p">
          This page does not exist, or it was deleted with its book.
        </Text>
        <Link href="/" isStandalone>
          Back to your books
        </Link>
      </VStack>
    );
  }
  if (!page) return error ? <ErrorNote message={error} hint="Still trying…" /> : <Spinner size="lg" aria-label="Loading the page" />;

  const title = page.pageNumber ? `Page ${page.pageNumber}` : 'This page';
  const back = (
    <Link href={`/books/${page.bookId}`} isStandalone>
      Back to the book
    </Link>
  );

  const waiting = (message: string) => (
    <VStack gap={4} paddingBlock={6} aria-live="polite">
      <Heading level={1}>{title}</Heading>
      <Text type="large" color="secondary" as="p">
        {message}
      </Text>
      <div className="drawn-line" aria-hidden="true" />
      <Text type="supporting" as="p">
        You can leave this screen. The page keeps going and will be waiting in your book.
      </Text>
      <ErrorNote message={error} hint="Still trying…" />
    </VStack>
  );

  switch (page.status) {
    case 'UPLOADED':
    case 'DETECTING':
      return waiting('Reading your pencil marks. This usually takes about 15 seconds.');
    case 'AWAITING_CHECK':
      return <MarkCheck page={page} onConfirmed={setPage} />;
    case 'EXPLAINING':
      return waiting('Writing explanations for your marks. This usually takes about 20 seconds.');
    case 'DONE':
      return <Results page={page} onPhotoDeleted={() => setPage({ ...page, hasPhoto: false })} />;
    case 'FAILED':
      return (
        <VStack gap={4} hAlign="start">
          <Heading level={1}>{page.photoUnusable ? 'This photo could not be read' : `${title} did not finish`}</Heading>
          <Text type="large" color="secondary" as="p">
            {page.failureReason}
          </Text>
          <ErrorNote message={error} />
          <HStack gap={3} vAlign="center">
            {page.photoUnusable ? (
              <Button label="Take a new photo" variant="primary" size="lg" href={`/books/${page.bookId}/capture?page=${page.pageNumber ?? ''}`} />
            ) : (
              <Button label="Retry" variant="primary" size="lg" isLoading={busy} onClick={() => void retry()} />
            )}
            {back}
          </HStack>
        </VStack>
      );
  }
}
