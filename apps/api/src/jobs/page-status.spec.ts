import { canMove, type PageStatus } from './page-status.js';

const ALL: PageStatus[] = ['UPLOADED', 'DETECTING', 'AWAITING_CHECK', 'EXPLAINING', 'DONE', 'FAILED'];

describe('page status rules', () => {
  it('allows UPLOADED→DETECTING→AWAITING_CHECK→EXPLAINING→DONE', () => {
    expect(canMove('UPLOADED', 'DETECTING')).toBe(true);
    expect(canMove('DETECTING', 'AWAITING_CHECK')).toBe(true);
    expect(canMove('AWAITING_CHECK', 'EXPLAINING')).toBe(true);
    expect(canMove('EXPLAINING', 'DONE')).toBe(true);
  });

  it('allows DETECTING→FAILED and EXPLAINING→FAILED', () => {
    expect(canMove('DETECTING', 'FAILED')).toBe(true);
    expect(canMove('EXPLAINING', 'FAILED')).toBe(true);
  });

  it('allows FAILED→UPLOADED and FAILED→EXPLAINING for retry', () => {
    expect(canMove('FAILED', 'UPLOADED')).toBe(true);
    expect(canMove('FAILED', 'EXPLAINING')).toBe(true);
  });

  it('rejects AWAITING_CHECK→DONE and DONE→anything', () => {
    expect(canMove('AWAITING_CHECK', 'DONE')).toBe(false);
    for (const to of ALL) expect(canMove('DONE', to)).toBe(false);
  });

  it('rejects skipping steps, going backwards and staying put', () => {
    expect(canMove('UPLOADED', 'AWAITING_CHECK')).toBe(false);
    expect(canMove('UPLOADED', 'FAILED')).toBe(false);
    expect(canMove('AWAITING_CHECK', 'DETECTING')).toBe(false);
    expect(canMove('AWAITING_CHECK', 'FAILED')).toBe(false);
    expect(canMove('FAILED', 'DONE')).toBe(false);
    for (const status of ALL) expect(canMove(status, status)).toBe(false);
  });

  it('allows exactly eight moves', () => {
    const allowed = ALL.flatMap((from) => ALL.filter((to) => canMove(from, to)).map((to) => `${from}→${to}`));
    expect(allowed).toHaveLength(8);
  });
});
