import type { PrismaClient } from '../generated/prisma/client.js';
import { movePage } from './page-status.js';
import type { PageQueue } from './queues.js';

/** A page whose status has not changed for this long is assumed to have lost its job. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/**
 * A page still being read or explained after this long is not coming back:
 * something about it keeps failing. It is marked FAILED, so the reader gets a
 * Retry button instead of an endless wait, and it stops costing AI calls.
 */
export const GIVE_UP_AFTER_MS = 60 * 60 * 1000;

const TOOK_TOO_LONG = 'This page took too long to process. Please try again.';

/**
 * PostgreSQL is the source of truth and Redis only holds waiting work. If a
 * job was lost (Redis was down at upload, or its data was lost), this puts
 * the page back on the queue. Pages already waiting are not added twice.
 *
 * Pages stuck in DETECTING or EXPLAINING for over an hour are failed instead,
 * and a failed detection gives the reader's daily page back. A page still in
 * UPLOADED has not started, so it keeps waiting for the queue.
 *
 * Returns how many pages were re-queued.
 */
export async function requeueStuckPages(
  db: Pick<PrismaClient, 'page'>,
  queue: PageQueue,
  now: Date,
  usage?: { release(userId: string, countedOn: Date): Promise<void> },
): Promise<number> {
  const stuck = await db.page.findMany({
    where: {
      status: { in: ['UPLOADED', 'DETECTING', 'EXPLAINING'] },
      statusChangedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    },
    select: { id: true, status: true, statusChangedAt: true, book: { select: { userId: true } } },
  });
  let requeued = 0;
  for (const page of stuck) {
    const working = page.status === 'DETECTING' || page.status === 'EXPLAINING';
    if (working && now.getTime() - page.statusChangedAt.getTime() > GIVE_UP_AFTER_MS) {
      const failed = await movePage(db, page.id, page.status as 'DETECTING' | 'EXPLAINING', 'FAILED', { failureReason: TOOK_TOO_LONG });
      if (failed && page.status === 'DETECTING') await usage?.release(page.book.userId, page.statusChangedAt);
      continue;
    }
    if (page.status === 'EXPLAINING') await queue.enqueueExplanation(page.id);
    else await queue.enqueueDetection(page.id);
    requeued++;
  }
  return requeued;
}
