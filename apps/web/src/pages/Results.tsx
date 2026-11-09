import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { messageOf, type PageInfo, type PageResult, useApi } from '../api';

const KIND_LABEL = { word: 'Word', grammar: 'Grammar', translation: 'Translation' } as const;
const MARK_CLASS = { word: 'mark-underline_save', grammar: 'mark-curly', translation: 'mark-underline_translate' } as const;

/** A finished page: one entry per mark, in the order the marks are on the page. */
export function Results({ page, onPhotoDeleted }: { page: PageInfo; onPhotoDeleted: () => void }) {
  const api = useApi();
  const [results, setResults] = useState<PageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pageResults(page.id).then(setResults, (e: unknown) => setError(messageOf(e)));
  }, [api, page.id]);

  if (!results) return error ? <p className="error">{error}</p> : <p className="note">Loading results…</p>;

  return (
    <>
      <p>
        <Link to={`/books/${page.bookId}`}>Back to the book</Link>
      </p>
      <h1>Page {page.pageNumber}</h1>
      <p className="lede">
        {results.length === 0
          ? 'There was nothing to explain on this page.'
          : 'Saved words and grammar are in your word bank and will come up in review.'}
      </p>

      <div className="results">
        {results.map((result) => (
          <article key={result.markId} className={`result ${MARK_CLASS[result.kind]}`}>
            <p className="result-marked">
              <span className="mark-text" data-testid="marked" lang="ko">
                {result.text}
              </span>
              <span className="mark-label">{KIND_LABEL[result.kind]}</span>
            </p>
            {result.kind === 'translation' ? (
              <p className="result-meaning">{result.translation}</p>
            ) : (
              <>
                <p className="result-form korean" lang="ko">
                  {result.normalForm}
                </p>
                <p className="result-meaning">{result.meaning}</p>
                {result.notes && <p className="result-notes">{result.notes}</p>}
                <dl className="result-lines">
                  <dt>In your book</dt>
                  <dd>
                    <span className="korean" lang="ko">
                      {result.sentence}
                    </span>
                    {result.sentenceTranslation && <span className="translation">{result.sentenceTranslation}</span>}
                  </dd>
                  {result.example && (
                    <>
                      <dt>Example</dt>
                      <dd>
                        <span className="korean" lang="ko">
                          {result.example}
                        </span>
                        {result.exampleTranslation && <span className="translation">{result.exampleTranslation}</span>}
                      </dd>
                    </>
                  )}
                </dl>
                {result.seenBefore.map((seen) => (
                  <aside key={seen.pageId + seen.sentence} className="seen-before">
                    <p>
                      You saw this on page {seen.pageNumber}
                      {seen.bookId !== page.bookId ? ` of ${seen.bookTitle}` : ''}.
                    </p>
                    <p className="korean" lang="ko">
                      {seen.sentence}
                    </p>
                  </aside>
                ))}
              </>
            )}
          </article>
        ))}
      </div>

      {page.hasPhoto && <DeletePhoto pageId={page.id} onDeleted={onPhotoDeleted} />}
    </>
  );
}

/** Photos are deleted after 30 days anyway; this does it now. */
function DeletePhoto({ pageId, onDeleted }: { pageId: string; onDeleted: () => void }) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    try {
      await api.deletePagePhoto(pageId);
      setAsking(false);
      onDeleted();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <section className="danger-zone">
      {asking ? (
        <>
          <p>The photo is deleted now instead of after 30 days. These results and your word bank stay.</p>
          <div className="editor">
            <button type="button" className="button danger" onClick={remove}>
              Delete the photo
            </button>
            <button type="button" className="quiet-button" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="quiet-button" onClick={() => setAsking(true)}>
          Delete photo
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
