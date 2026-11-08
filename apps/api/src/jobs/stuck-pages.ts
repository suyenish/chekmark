import type { PrismaClient } from '../generated/prisma/client.js';
import type { PageQueue } from './queues.js';

/** A page whose status has not changed for this long is assumed to have lost its job. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/**
 * PostgreSQL is the source of truth and Redis only holds waiting work. If a
 * job was lost (Redis was down at upload, or its data was lost), this puts
 * the page back on the queue. Pages already waiting are not added twice.
 * Returns how many pages were re-queued.
 */
export async function requeueStuckPages(db: Pick<PrismaClient, 'page'>, queue: PageQueue, now: Date): Promise<number> {
  const stuck = await db.page.findMany({
    where: {
      status: { in: ['UPLOADED', 'DETECTING', 'EXPLAINING'] },
      statusChangedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    },
    select: { id: true, status: true },
  });
  for (const page of stuck) {
    if (page.status === 'EXPLAINING') await queue.enqueueExplanation(page.id);
    else await queue.enqueueDetection(page.id);
  }
  return stuck.length;
}
