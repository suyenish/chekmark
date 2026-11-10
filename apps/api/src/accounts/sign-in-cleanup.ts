import type { PrismaClient } from '../generated/prisma/client.js';

/** Expired sign-in links are kept this long, then removed. */
export const KEEP_EXPIRED_LINKS_MS = 24 * 60 * 60 * 1000;

/**
 * Removes sessions that have expired and sign-in links that expired over a
 * day ago. Neither can be used any more; this only stops the tables growing.
 */
export async function deleteExpiredSignIns(db: Pick<PrismaClient, 'session' | 'loginToken'>, now: Date): Promise<{ sessions: number; links: number }> {
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const links = await db.loginToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - KEEP_EXPIRED_LINKS_MS) } } });
  return { sessions: sessions.count, links: links.count };
}
