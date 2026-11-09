/**
 * Flashcard scheduling, SM-2 style. Kept on its own so it can be replaced
 * (for example by FSRS) without changing anything else.
 */
export type Rating = 'again' | 'hard' | 'easy';

export const RATINGS: readonly Rating[] = ['again', 'hard', 'easy'];

export interface CardState {
  /** Days until the next review. 0 means new, or just forgotten. */
  intervalDays: number;
  /** How fast the interval grows on Easy. Starts at 2.5. */
  ease: number;
}

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 10 * 60 * 1000;

/** Two decimals, so many small changes do not drift (2.5 - 0.2 must be exactly 2.3). */
const easeOf = (value: number) => Math.max(MIN_EASE, Math.round(value * 100) / 100);

export function schedule(card: CardState, rating: Rating, now: Date): CardState & { dueAt: Date } {
  if (rating === 'again') {
    return { intervalDays: 0, ease: easeOf(card.ease - 0.2), dueAt: new Date(now.getTime() + AGAIN_DELAY_MS) };
  }
  const isNew = card.intervalDays === 0;
  const intervalDays =
    rating === 'hard'
      ? isNew ? 1 : Math.ceil(card.intervalDays * 1.2)
      : isNew ? 3 : Math.round(card.intervalDays * card.ease);
  const ease = easeOf(card.ease + (rating === 'hard' ? -0.15 : 0.05));
  return { intervalDays, ease, dueAt: new Date(now.getTime() + intervalDays * DAY_MS) };
}
