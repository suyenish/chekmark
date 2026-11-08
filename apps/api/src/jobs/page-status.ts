import type { FailedStage, PageStatus, PrismaClient } from '../generated/prisma/client.js';

export type { PageStatus };

/**
 * Every move a page may make. A page moves forward through detection, the
 * reader's Mark check and explanation. Detection and explanation can fail,
 * and a failed page can be retried from the step that failed.
 */
const MOVES: Record<PageStatus, readonly PageStatus[]> = {
  UPLOADED: ['DETECTING'],
  DETECTING: ['AWAITING_CHECK', 'FAILED'],
  AWAITING_CHECK: ['EXPLAINING'],
  EXPLAINING: ['DONE', 'FAILED'],
  DONE: [],
  FAILED: ['UPLOADED', 'EXPLAINING'],
};

export function canMove(from: PageStatus, to: PageStatus): boolean {
  return MOVES[from].includes(to);
}

type Db = Pick<PrismaClient, 'page'>;

/**
 * Moves a page in one conditional update, so two jobs cannot both move it.
 * Returns false when the page is not in the `from` status (another job got
 * there first, or the page was deleted). Throws for a move the rules forbid.
 */
export async function movePage(
  db: Db,
  pageId: string,
  from: PageStatus,
  to: PageStatus,
  extra: { failedStage?: FailedStage; failureReason?: string } = {},
): Promise<boolean> {
  if (!canMove(from, to)) throw new Error(`A page cannot move ${from} → ${to}`);
  const failure =
    to === 'FAILED'
      ? { failedStage: extra.failedStage ?? (from as FailedStage), failureReason: extra.failureReason ?? null }
      : { failedStage: null, failureReason: null };
  const { count } = await db.page.updateMany({
    where: { id: pageId, status: from },
    data: { status: to, statusChangedAt: new Date(), ...failure },
  });
  return count === 1;
}
