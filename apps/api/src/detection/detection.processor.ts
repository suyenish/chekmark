import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { UsageService } from '../accounts/usage.service.js';
import { AI_CLIENT, type AiClient, AiOutputInvalidError } from '../ai/ai-client.js';
import { movePage } from '../jobs/page-status.js';
import type { PageJob } from '../jobs/queues.js';
import { PHOTO_STORE, type PhotoStore } from '../photos/photo-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DETECTION_SYSTEM_PROMPT, DETECTION_USER_PROMPT } from './detection.prompt.js';
import { type DetectionResult, detectionResultSchema, dropInvalidBoxes } from './detection.schema.js';

/** What the processor needs from a BullMQ job. `attemptsMade` counts earlier failed attempts. */
export type DetectionJob = { data: PageJob; attemptsMade: number; opts: { attempts?: number } };

const RETRY_LATER = 'We could not read this page right now. Please try again.';
const COULD_NOT_READ = 'We could not read the marks on this photo. Please try again, or retake the photo.';

/** Turns a page photo into marks. Safe to run twice: marks are replaced, never added twice. */
@Injectable()
export class DetectionProcessor {
  private readonly logger = new Logger(DetectionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
    @Inject(AI_CLIENT) private readonly ai: AiClient,
    private readonly usage: UsageService,
  ) {}

  async process(job: DetectionJob): Promise<void> {
    const { pageId } = job.data;
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { book: { select: { userId: true } } } });
    if (!page) return; // deleted while waiting
    // UPLOADED is the normal start. DETECTING means a retry, or a stuck page re-queued.
    if (page.status === 'UPLOADED') {
      if (!(await movePage(this.prisma, pageId, 'UPLOADED', 'DETECTING'))) return;
    } else if (page.status !== 'DETECTING') {
      return; // already done by an earlier run
    }
    const userId = page.book.userId;
    // When the page entered UPLOADED (its upload or a retry) is when its usage was counted.
    const countedOn = page.statusChangedAt;

    try {
      const photo = await this.photos.get(page.photoKey);
      const result = dropInvalidBoxes(
        await this.ai.generate({
          purpose: 'detect',
          system: DETECTION_SYSTEM_PROMPT,
          prompt: DETECTION_USER_PROMPT,
          schema: detectionResultSchema,
          imageJpeg: photo,
          userId,
          pageId,
        }),
      );
      if (result.photo_usable) await this.saveMarks(pageId, result);
      else await this.failUnusable(pageId, userId, countedOn, result);
    } catch (error) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(`Detection attempt ${job.attemptsMade + 1} for page ${pageId} failed: ${String(error)}`);
      if (lastAttempt) {
        const reason = error instanceof AiOutputInvalidError ? COULD_NOT_READ : RETRY_LATER;
        if (await movePage(this.prisma, pageId, 'DETECTING', 'FAILED', { failureReason: reason })) {
          await this.usage.release(userId, countedOn);
        }
      }
      throw error; // BullMQ retries, or records the final failure
    }
  }

  private async saveMarks(pageId: string, result: DetectionResult): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.mark.deleteMany({ where: { pageId } });
      await tx.mark.createMany({
        data: result.marks.map((mark, order) => ({
          pageId,
          order,
          type: mark.type,
          text: mark.text,
          normalForm: mark.normal_form,
          sentence: mark.sentence,
          position: mark.box ?? undefined,
          source: 'detected' as const,
        })),
      });
      await tx.page.update({ where: { id: pageId }, data: { detectionResult: result as unknown as Prisma.InputJsonValue } });
      // If another run already moved the page on, undo this run's writes.
      if (!(await movePage(tx, pageId, 'DETECTING', 'AWAITING_CHECK'))) throw new PageMovedOnError();
    }).catch((error: unknown) => {
      if (!(error instanceof PageMovedOnError)) throw error;
    });
  }

  /** A blurry, dark or cut-off photo does not count towards the daily limit. */
  private async failUnusable(pageId: string, userId: string, countedOn: Date, result: DetectionResult): Promise<void> {
    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.mark.deleteMany({ where: { pageId } });
      await tx.page.update({ where: { id: pageId }, data: { detectionResult: result as unknown as Prisma.InputJsonValue } });
      return movePage(tx, pageId, 'DETECTING', 'FAILED', { failureReason: result.problem ?? 'The photo could not be read.' });
    });
    if (moved) await this.usage.release(userId, countedOn);
  }
}

class PageMovedOnError extends Error {}
