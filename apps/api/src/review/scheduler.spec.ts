import { schedule } from './scheduler.js';

const now = new Date('2026-01-01T00:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe('schedule (SM-2 style)', () => {
  it('Again resets the interval and repeats in 10 minutes', () => {
    expect(schedule({ intervalDays: 10, ease: 2.5 }, 'again', now)).toEqual({
      intervalDays: 0,
      ease: 2.3,
      dueAt: new Date('2026-01-01T00:10:00Z'),
    });
  });

  it('Hard on a new card gives 1 day and lowers ease by 0.15', () => {
    expect(schedule({ intervalDays: 0, ease: 2.5 }, 'hard', now)).toEqual({ intervalDays: 1, ease: 2.35, dueAt: days(1) });
  });

  it('Hard on a reviewed card multiplies the interval by 1.2, rounded up', () => {
    expect(schedule({ intervalDays: 4, ease: 2.5 }, 'hard', now)).toEqual({ intervalDays: 5, ease: 2.35, dueAt: days(5) }); // 4.8 → 5
    expect(schedule({ intervalDays: 1, ease: 2.5 }, 'hard', now).intervalDays).toBe(2); // 1.2 → 2
  });

  it('Easy on a new card gives 3 days and raises ease by 0.05', () => {
    expect(schedule({ intervalDays: 0, ease: 2.5 }, 'easy', now)).toEqual({ intervalDays: 3, ease: 2.55, dueAt: days(3) });
  });

  it('Easy on a reviewed card multiplies the interval by ease, rounded', () => {
    expect(schedule({ intervalDays: 3, ease: 2.5 }, 'easy', now)).toEqual({ intervalDays: 8, ease: 2.55, dueAt: days(8) }); // 7.5 → 8
    expect(schedule({ intervalDays: 10, ease: 1.3 }, 'easy', now).intervalDays).toBe(13);
  });

  it('ease never goes below 1.3', () => {
    expect(schedule({ intervalDays: 5, ease: 1.4 }, 'again', now).ease).toBe(1.3);
    expect(schedule({ intervalDays: 5, ease: 1.3 }, 'hard', now).ease).toBe(1.3);
  });

  it('keeps ease to two decimals after many reviews, so it does not drift', () => {
    let card = { intervalDays: 0, ease: 2.5 };
    for (const rating of ['hard', 'easy', 'again', 'easy', 'hard', 'easy'] as const) card = schedule(card, rating, now);
    expect(card.ease).toBe(Math.round(card.ease * 100) / 100);
    expect(card.ease).toBe(2.15); // 2.5 → 2.35 → 2.4 → 2.2 → 2.25 → 2.1 → 2.15
  });
});
