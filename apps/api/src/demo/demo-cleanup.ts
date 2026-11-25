import { Logger } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';

const logger = new Logger('DemoCleanup');

/** Deletes demo accounts whose 24 hours are over. One that fails is tried again on the next run. */
export async function deleteExpiredDemos(db: Pick<PrismaClient, 'user'>, accounts: { deleteAccount(userId: string): Promise<void> }, now: Date): Promise<number> {
  const expired = await db.user.findMany({ where: { demoExpiresAt: { lt: now } }, select: { id: true } });
  let deleted = 0;
  for (const { id } of expired) {
    try {
      await accounts.deleteAccount(id);
      deleted++;
    } catch (error) {
      logger.warn(`Could not delete demo account ${id}: ${String(error)}`);
    }
  }
  return deleted;
}
