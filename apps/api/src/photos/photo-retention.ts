import { Logger } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { PhotoStore } from './photo-store.js';

/** Photos are kept for 30 days after the page last changed status, then deleted. */
export const PHOTO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const logger = new Logger('PhotoRetention');

/**
 * Deletes photos of pages unchanged for over 30 days, whatever their status.
 * Each photo is removed from storage first and only then marked deleted, so a
 * storage failure leaves the page as it was and the next run tries again.
 * Marks, results and the word bank are kept. Returns how many were deleted.
 */
export async function deleteExpiredPhotos(db: Pick<PrismaClient, 'page'>, store: PhotoStore, now: Date): Promise<number> {
  const expired = await db.page.findMany({
    where: { photoDeletedAt: null, statusChangedAt: { lt: new Date(now.getTime() - PHOTO_RETENTION_MS) } },
    select: { id: true, photoKey: true },
  });
  let deleted = 0;
  for (const page of expired) {
    try {
      await store.delete(page.photoKey);
      await db.page.update({ where: { id: page.id }, data: { photoDeletedAt: now } });
      deleted++;
    } catch (error) {
      logger.warn(`Could not delete the photo of page ${page.id}; the next run tries again: ${String(error)}`);
    }
  }
  return deleted;
}
