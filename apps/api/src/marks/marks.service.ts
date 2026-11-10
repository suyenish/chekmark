import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsageService } from '../accounts/usage.service.js';
import { type Mark, type MarkType, type Page, Prisma } from '../generated/prisma/client.js';
import { movePage } from '../jobs/page-status.js';
import { PAGE_QUEUE, type PageQueue } from '../jobs/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The types a reader can choose. `unclear` is only ever set by detection. */
export type ChosenType = Exclude<MarkType, 'unclear'>;

export type MarkEdit = {
  type?: ChosenType;
  /** The save switch: on makes an underline `underline_save`, off makes it `underline_translate`. */
  save?: boolean;
  text?: string;
  normalForm?: string | null;
  sentence?: string | null;
};

export type NewMark = { type: ChosenType; text: string; normalForm?: string | null; sentence?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_IN_CHECK = 'Marks can only be changed while the page is waiting for your Mark check.';

const kindOf = (type: MarkType) => (type === 'underline_save' ? 'word' : type === 'curly' ? 'grammar' : 'other');

/**
 * Only saved types have a dictionary form, and a translation never does.
 * When the reader does not give one, it is left empty and the explanation
 * step reads it from the photo, rather than guessing from the marked text.
 */
function normalFormFor(type: MarkType, given: string | null | undefined): string | null {
  if (kindOf(type) === 'other') return null;
  const trimmed = given?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The Mark check: the reader corrects what detection found, then confirms.
 * Every status change goes through movePage, so of two simultaneous requests
 * (a double tap on Confirm) exactly one succeeds and the other gets 409.
 */
@Injectable()
export class MarksService {
  private readonly logger = new Logger(MarksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAGE_QUEUE) private readonly queue: PageQueue,
    private readonly usage: UsageService,
  ) {}

  async listMarks(userId: string, pageId: string): Promise<Mark[]> {
    await this.ownPage(userId, pageId);
    return this.prisma.mark.findMany({ where: { pageId }, orderBy: { order: 'asc' } });
  }

  async editMark(userId: string, markId: string, edit: MarkEdit): Promise<Mark> {
    const mark = await this.ownMark(userId, markId);
    if (edit.type !== undefined && edit.save !== undefined) throw new BadRequestException('Send either type or save, not both.');

    let type: MarkType = edit.type ?? mark.type;
    if (edit.save !== undefined) {
      if (mark.type !== 'underline_save' && mark.type !== 'underline_translate') {
        throw new BadRequestException('The save switch is only for underlines.');
      }
      type = edit.save ? 'underline_save' : 'underline_translate';
    }
    const text = edit.text ?? mark.text;
    // A new text, or a switch between word and grammar, makes the old dictionary form wrong.
    const stillValid = text === mark.text && kindOf(type) === kindOf(mark.type);
    const normalForm = normalFormFor(type, edit.normalForm !== undefined ? edit.normalForm : stillValid ? mark.normalForm : null);
    const sentence = edit.sentence !== undefined ? edit.sentence : mark.sentence;

    // The page filter makes the edit fail if the page left the Mark check meanwhile.
    const { count } = await this.prisma.mark.updateMany({
      where: { id: markId, page: { status: 'AWAITING_CHECK' } },
      data: { type, text, normalForm, sentence, source: mark.source === 'added' ? 'added' : 'corrected' },
    });
    if (count === 0) throw new ConflictException(NOT_IN_CHECK);
    return this.prisma.mark.findUniqueOrThrow({ where: { id: markId } });
  }

  async deleteMark(userId: string, markId: string): Promise<void> {
    await this.ownMark(userId, markId);
    const { count } = await this.prisma.mark.deleteMany({ where: { id: markId, page: { status: 'AWAITING_CHECK' } } });
    if (count === 0) throw new ConflictException(NOT_IN_CHECK);
  }

  /** A mark detection missed. It goes after the existing marks. */
  async addMark(userId: string, pageId: string, mark: NewMark): Promise<Mark> {
    const page = await this.ownPage(userId, pageId);
    if (page.status !== 'AWAITING_CHECK') throw new ConflictException(NOT_IN_CHECK);
    const last = await this.prisma.mark.aggregate({ where: { pageId }, _max: { order: true } });
    return this.prisma.mark.create({
      data: {
        pageId,
        order: (last._max.order ?? -1) + 1,
        type: mark.type,
        text: mark.text,
        normalForm: normalFormFor(mark.type, mark.normalForm),
        sentence: mark.sentence ?? null,
        source: 'added',
      },
    });
  }

  /**
   * Ends the Mark check. With marks, the page moves to EXPLAINING and one
   * explanation job is queued. With none, there is nothing to explain, so the
   * page moves on to DONE in the same transaction, without an AI call.
   */
  async confirm(userId: string, pageId: string): Promise<Page> {
    const page = await this.ownPage(userId, pageId);
    if (page.status !== 'AWAITING_CHECK') throw new ConflictException('This page has already been confirmed.');
    const unclear = await this.prisma.mark.count({ where: { pageId, type: 'unclear' } });
    if (unclear > 0) throw new ConflictException(`Choose a type for or remove ${unclear} unclear mark(s) before confirming.`);

    const markCount = await this.prisma.mark.count({ where: { pageId } });
    const moved = await this.prisma.$transaction(async (tx) => {
      if (!(await movePage(tx, pageId, 'AWAITING_CHECK', 'EXPLAINING'))) return false;
      if (markCount === 0) await movePage(tx, pageId, 'EXPLAINING', 'DONE');
      return true;
    });
    if (!moved) throw new ConflictException('This page has already been confirmed.');
    if (markCount > 0) await this.enqueue(() => this.queue.enqueueExplanation(pageId), pageId);
    return this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
  }

  /** Runs the failed step again: detection (needs the photo, counts as a page) or explanation. */
  async retry(userId: string, pageId: string): Promise<Page> {
    const page = await this.ownPage(userId, pageId);
    if (page.status !== 'FAILED') throw new ConflictException('Only a page that failed can be retried.');
    const now = new Date();

    if (page.failedStage === 'EXPLAINING') {
      await this.usage.assertBudgetAvailable(now);
      if (!(await movePage(this.prisma, pageId, 'FAILED', 'EXPLAINING'))) throw new ConflictException('This page is already being retried.');
      await this.enqueue(() => this.queue.enqueueExplanation(pageId, { retry: true }), pageId);
    } else {
      if (page.photoDeletedAt) {
        throw new ConflictException('The photo of this page has been deleted. Please upload the page again.');
      }
      await this.usage.admitPage(userId, now);
      if (!(await movePage(this.prisma, pageId, 'FAILED', 'UPLOADED'))) {
        await this.usage.release(userId, now);
        throw new ConflictException('This page is already being retried.');
      }
      // The new detection replaces the old answer, including an "unusable photo" verdict.
      await this.prisma.page.update({ where: { id: pageId }, data: { detectionResult: Prisma.DbNull } });
      await this.enqueue(() => this.queue.enqueueDetection(pageId, { retry: true }), pageId);
    }
    return this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
  }

  /** If the queue is down the status is already saved, and the stuck-page check queues it later. */
  private async enqueue(add: () => Promise<void>, pageId: string): Promise<void> {
    await add().catch((error: unknown) => {
      this.logger.warn(`Page ${pageId} not queued; the stuck-page check will queue it: ${String(error)}`);
    });
  }

  private async ownPage(userId: string, pageId: string): Promise<Page> {
    const page = UUID.test(pageId) ? await this.prisma.page.findFirst({ where: { id: pageId, book: { userId } } }) : null;
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  private async ownMark(userId: string, markId: string): Promise<Mark> {
    const mark = UUID.test(markId) ? await this.prisma.mark.findFirst({ where: { id: markId, page: { book: { userId } } } }) : null;
    if (!mark) throw new NotFoundException('Mark not found');
    return mark;
  }
}
