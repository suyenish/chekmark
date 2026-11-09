import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { messageOf, type PageInfo, type PageStatus, useApi } from '../api';
import { MarkCheck } from './MarkCheck';

/** While the worker is busy, the page is asked for again every 2 seconds. */
export const POLL_MS = 2000;
const WORKING: PageStatus[] = ['UPLOADED', 'DETECTING', 'EXPLAINING'];

/** One page from upload to finish: waiting, Mark check, explaining, done or failed. */
export function PageScreen({ pageId }: { pageId: string }) {
  const api = useApi();
  const [page, setPage] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.getPage(pageId);
        if (stopped) return;
        setPage(next);
        if (WORKING.includes(next.status)) timer = setTimeout(load, POLL_MS);
      } catch (e) {
        if (!stopped) setError(messageOf(e));
      }
    };
    // Start again whenever the page goes back to a working status (after Confirm or Retry).
    if (!page || WORKING.includes(page.status)) void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the status changes
  }, [api, pageId, page?.status]);

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

  if (!page) return error ? <p className="error">{error}</p> : <p className="note">Loading…</p>;

  const title = page.pageNumber ? `Page ${page.pageNumber}` : 'This page';
  const back = (
    <p>
      <Link to={`/books/${page.bookId}`}>Back to the book</Link>
    </p>
  );

  switch (page.status) {
    case 'UPLOADED':
    case 'DETECTING':
      return (
        <div className="waiting" aria-live="polite">
          <h1>{title}</h1>
          <p className="lede">Reading your pencil marks. This usually takes about 15 seconds.</p>
          <div className="drawn-line" aria-hidden="true" />
        </div>
      );
    case 'AWAITING_CHECK':
      return <MarkCheck page={page} onConfirmed={setPage} />;
    case 'EXPLAINING':
      return (
        <div className="waiting" aria-live="polite">
          <h1>{title}</h1>
          <p className="lede">Writing explanations for your marks. This usually takes about 20 seconds.</p>
          <div className="drawn-line" aria-hidden="true" />
        </div>
      );
    case 'DONE':
      return (
        <>
          <h1>{title} is finished</h1>
          <p className="lede">The words and grammar you marked are in your word bank. The results screen is coming soon.</p>
          {back}
        </>
      );
    case 'FAILED':
      return (
        <>
          <h1>{page.photoUnusable ? 'This photo could not be read' : `${title} did not finish`}</h1>
          <p className="lede">{page.failureReason}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {page.photoUnusable ? (
            <p>
              <Link className="button primary" to={`/books/${page.bookId}/capture?page=${page.pageNumber ?? ''}`}>
                Take a new photo
              </Link>
            </p>
          ) : (
            <p>
              <button type="button" className="button primary" disabled={busy} onClick={retry}>
                Retry
              </button>
            </p>
          )}
          {back}
        </>
      );
  }
}
