import { useCallback, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { type DueCard, messageOf, type Rating, useApi } from '../api';
import { ErrorNote } from '../ui';

const RATINGS: { rating: Rating; label: string; variant: 'secondary' | 'primary' }[] = [
  { rating: 'again', label: 'Again', variant: 'secondary' },
  { rating: 'hard', label: 'Hard', variant: 'secondary' },
  { rating: 'easy', label: 'Easy', variant: 'primary' },
];

/** The sentence from the reader's own book, with the marked word or pattern highlighted. */
function Front({ card }: { card: DueCard }) {
  const { sentence, highlight } = card.front;
  return (
    <p className="card-sentence" lang="ko" data-testid="front">
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

  if (error && !cards) return <ErrorNote message={error} />;
  if (!cards) return <Spinner size="lg" label="Loading your cards…" />;

  if (cards.length === 0) {
    return (
      <VStack gap={3} hAlign="start">
        <Heading level={1}>Review</Heading>
        <Text type="large" color="secondary" as="p">
          {done > 0
            ? `All done for now. You reviewed ${done} card${done === 1 ? '' : 's'}.`
            : 'Nothing to review right now. Words and grammar from your pages come here when they are due.'}
        </Text>
        <Link href="/" isStandalone>
          Back to your books
        </Link>
      </VStack>
    );
  }

  const card = cards[0];
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="end">
        <Heading level={1}>Review</Heading>
        <Text type="supporting">{cards.length} left</Text>
      </HStack>

      <VStack gap={3} aria-live="polite">
        <Text type="supporting" as="p">
          {card.kind === 'word' ? 'What does the marked word mean here?' : 'What does this grammar mean here?'}
        </Text>
        <Front card={card} />
        {revealed && (
          <VStack gap={3}>
            <Divider />
            <VStack gap={1}>
              <Text type="large" weight="bold" as="p">
                <span className="korean" lang="ko">
                  {card.normalForm}
                </span>
              </Text>
              <Text type="large" weight="medium" as="p">
                {card.back.meaning}
              </Text>
              {card.back.notes && (
                <Text color="secondary" as="p">
                  {card.back.notes}
                </Text>
              )}
            </VStack>
            {card.back.sentenceTranslation && (
              <Text color="secondary" as="p">
                {card.back.sentenceTranslation}
              </Text>
            )}
            {card.back.example && (
              <VStack gap={0.5}>
                <Text as="p">
                  <span className="korean" lang="ko">
                    {card.back.example}
                  </span>
                </Text>
                {card.back.exampleTranslation && (
                  <Text color="secondary" as="p">
                    {card.back.exampleTranslation}
                  </Text>
                )}
              </VStack>
            )}
            {card.source && (
              <Text type="supporting" as="p">
                From {card.source.bookTitle}, page {card.source.pageNumber}
              </Text>
            )}
          </VStack>
        )}
      </VStack>
      <ErrorNote message={error} />

      <div className="action-bar">
        {revealed ? (
          <VStack gap={2}>
            <Text type="supporting" as="p" justify="center">
              How well did you know it?
            </Text>
            <HStack gap={2}>
              {RATINGS.map(({ rating, label, variant }) => (
                <Button key={rating} label={label} variant={variant} size="lg" width="100%" isDisabled={busy} onClick={() => void rate(rating)} />
              ))}
            </HStack>
          </VStack>
        ) : (
          <Button label="Show answer" variant="primary" size="lg" width="100%" onClick={() => setRevealed(true)} />
        )}
      </div>
    </VStack>
  );
}
