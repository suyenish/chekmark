import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { hashSecret, newSecret, type SignedInUser } from '../accounts/auth.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { REDIS } from '../jobs/queues.js';
import { PHOTO_STORE, type PhotoStore, pagePhotoKey } from '../photos/photo-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ExplainResult, saveResults } from '../wordbank/save-results.js';
import { DEMO_BOOK_TITLE, DEMO_PAGES, savedAnswer, savedTranslation } from './sample-data.js';

export const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** New demos in the whole app in one hour. Each one is a few rows and one small photo. */
export const DEMOS_PER_HOUR = 60;

/** The same place from src/demo and from dist/demo. */
const PHOTO_FILE = new URL('../../assets/demo-page.jpg', import.meta.url);

/** Temporary accounts filled with sample data, so anyone can look around without an email. */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
  ) {}

  async start(): Promise<{ user: SignedInUser; sessionId: string }> {
    const now = new Date();
    await this.countStart(now);

    const userId = randomUUID();
    const waitingPageId = randomUUID();
    const photoKey = pagePhotoKey(userId, waitingPageId);
    const email = `demo-${userId}@demo.invalid`; // .invalid can never receive mail
    const expiresAt = new Date(now.getTime() + DEMO_LIFETIME_MS);
    const sessionId = newSecret();

    await this.photos.put(photoKey, await readFile(PHOTO_FILE));
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { id: userId, email, demoExpiresAt: expiresAt } });
        await tx.session.create({ data: { userId, tokenHash: hashSecret(sessionId), expiresAt } });
        const book = await tx.book.create({ data: { userId, title: DEMO_BOOK_TITLE } });
        for (const sample of DEMO_PAGES) await this.addPage(tx, userId, book.id, sample, sample.done ? randomUUID() : waitingPageId, now);
      });
    } catch (error) {
      await this.photos.delete(photoKey).catch(() => undefined);
      throw error;
    }
    return { user: { id: userId, email, demo: true }, sessionId };
  }

  private async addPage(tx: Prisma.TransactionClient, userId: string, bookId: string, sample: (typeof DEMO_PAGES)[number], pageId: string, now: Date) {
    await tx.page.create({
      data: {
        id: pageId,
        bookId,
        pageNumber: sample.pageNumber,
        photoKey: pagePhotoKey(userId, pageId),
        status: sample.done ? 'DONE' : 'AWAITING_CHECK',
        photoDeletedAt: sample.done ? now : null, // only the waiting page has a picture
      },
    });
    const marks = sample.marks.map((mark, order) => ({ ...mark, id: randomUUID(), pageId, order, source: 'detected' as const }));
    await tx.mark.createMany({ data: marks });
    if (!sample.done) return;
    const results = marks.map((mark): ExplainResult => {
      if (mark.type === 'underline_translate') return { markId: mark.id, kind: 'translation', translation: savedTranslation(mark.text) };
      return { markId: mark.id, kind: 'new', ...savedAnswer(mark.normalForm ?? mark.text), sentenceTranslation: savedTranslation(mark.sentence) };
    });
    await saveResults(tx, userId, pageId, results);
  }

  /** Unlike sign-in, a demo is refused when it cannot be counted: nobody is locked out of their own data. */
  private async countStart(now: Date): Promise<void> {
    const key = `demo:all:${now.toISOString().slice(0, 13)}`;
    let count: number;
    try {
      const results = await this.redis.multi().incr(key).expire(key, 2 * 60 * 60).exec();
      count = Number(results?.[0]?.[1]);
      if (!Number.isFinite(count)) throw new Error('no count');
    } catch (error) {
      this.logger.warn(`Could not count demos, so none was started: ${String(error)}`);
      throw new ServiceUnavailableException('The demo is not available right now. Please try again in a few minutes.');
    }
    if (count > DEMOS_PER_HOUR) throw new HttpException('The demo is busy right now. Please try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
