import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type DueCard, messageOf, type Rating, useApi } from '../api';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'easy', label: 'Easy' },
];

/** The sentence from the reader's own book, with the marked word or pattern highlighted. */
function Front({ card }: { card: DueCard }) {
  const { sentence, highlight } = card.front;
  return (
    <p className="card-sentence korean" lang="ko" data-testid="front">
      {highlight ? (
        <>
          {sentence.slice(0, highlight.start)}
          <mark>{highlight.text}</mark>
          {sentence.slice(highlight.start + highlight.text.length)}
        </>
      ) : (
        sentence
      )}
    </p>
  );
}

/** Due cards one at a time: read the sentence, recall, show the answer, rate. */
export function Review() {
  const api = useApi();
  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.dueCards().then(setCards, (e: unknown) => setError(messageOf(e))), [api]);
  useEffect(() => void load(), [load]);

  async function rate(rating: Rating) {
    if (!cards?.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.rateCard(cards[0].cardId, rating);
      setDone((n) => n + 1);
      setRevealed(false);
      const rest = cards.slice(1);
      if (rest.length > 0) setCards(rest);
      else await load(); // a card rated Again may be due again soon, and more may have come due
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !cards) return <p className="error">{error}</p>;
  if (!cards) return <p className="note">Loading cards…</p>;

  if (cards.length === 0) {
    return (
      <>
        <h1>Review</h1>
        <p className="lede">
          {done > 0
            ? `All done for now. You reviewed ${done} card${done === 1 ? '' : 's'}.`
            : 'Nothing to review right now. Words and grammar from your pages come here when they are due.'}
        </p>
        <p>
          <Link to="/">Back to your books</Link>
        </p>
      </>
    );
  }

  const card = cards[0];
  return (
    <>
      <div className="review-head">
        <h1>Review</h1>
        <span className="note">{cards.length} left</span>
      </div>
      <section className="review-card" aria-live="polite">
        <span className="mark-label">{card.kind === 'word' ? 'What does the marked word mean here?' : 'What does this grammar mean here?'}</span>
        <Front card={card} />
        {revealed && (
          <div className="card-back">
            <p className="result-form korean" lang="ko">
              {card.normalForm}
            </p>
            <p className="result-meaning">{card.back.meaning}</p>
            {card.back.notes && <p className="result-notes">{card.back.notes}</p>}
            {card.back.sentenceTranslation && <p className="translation">{card.back.sentenceTranslation}</p>}
            {card.back.example && (
              <p className="card-example">
                <span className="korean" lang="ko">
                  {card.back.example}
                </span>
                {card.back.exampleTranslation && <span className="translation">{card.back.exampleTranslation}</span>}
              </p>
            )}
            {card.source && (
              <p className="note">
                From {card.source.bookTitle}, page {card.source.pageNumber}
              </p>
            )}
          </div>
        )}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="action-bar">
        <div>
          {revealed ? (
            <div className="ratings">
              {RATINGS.map(({ rating, label }) => (
                <button key={rating} type="button" className={`button rating-${rating}`} disabled={busy} onClick={() => rate(rating)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="button primary wide" onClick={() => setRevealed(true)}>
              Show answer
            </button>
          )}
        </div>
      </div>
    </>
  );
}
