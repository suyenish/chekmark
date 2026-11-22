import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_CLIENT, type AiClient, AiOutputInvalidError } from '../ai/ai-client.js';
import type { Mark } from '../generated/prisma/client.js';
import { movePage } from '../jobs/page-status.js';
import type { PageJob } from '../jobs/queues.js';
import { PHOTO_STORE, type PhotoStore } from '../photos/photo-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toNormalForm } from '../wordbank/normal-form.js';
import { saveResults } from '../wordbank/save-results.js';
import {
  EXPLANATION_SYSTEM_PROMPT,
  type ExplainPromptMark,
  explanationUserPrompt,
  RESOLVE_SYSTEM_PROMPT,
  resolveUserPrompt,
} from './explanation.prompt.js';
import { explanationOutputSchema, type MarkToExplain, resolveOutputSchema, toExplainResults } from './explanation.schema.js';

export type ExplanationJob = { data: PageJob; attemptsMade: number; opts: { attempts?: number } };

const RETRY_LATER = 'We could not explain this page right now. Please try again.';
const COULD_NOT_EXPLAIN = 'We could not explain the marks on this page. Please try again.';

type WordOrGrammar = 'word' | 'grammar';
const kindOf = (mark: Mark): WordOrGrammar | 'translation' =>
  mark.type === 'underline_save' ? 'word' : mark.type === 'curly' ? 'grammar' : 'translation';

/**
 * Explains a confirmed page and saves the words and grammar to the word bank:
 * 1. a `resolve` call reads the dictionary form and sentence from the photo for
 *    marks the reader typed or retyped,
 * 2. the reader's existing senses are looked up by dictionary form,
 * 3. one `explain` call returns a translation, a matching sense or a new
 *    explanation for every mark,
 * 4. everything is saved and the page moves to DONE in one transaction.
 */
@Injectable()
export class ExplanationProcessor {
  private readonly logger = new Logger(ExplanationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
    @Inject(AI_CLIENT) private readonly ai: AiClient,
  ) {}

  async process(job: ExplanationJob): Promise<void> {
    const { pageId } = job.data;
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { book: { select: { userId: true, sourceLanguage: true } } } });
    if (!page || page.status !== 'EXPLAINING') return; // deleted, or already finished by an earlier run
    const userId = page.book.userId;

    try {
      let marks = await this.prisma.mark.findMany({ where: { pageId }, orderBy: { order: 'asc' } });
      marks = await this.resolveMissing(marks, page.photoKey, page.photoDeletedAt !== null, userId, pageId);

      const toExplain: MarkToExplain[] = [];
      const promptMarks: ExplainPromptMark[] = [];
      for (const mark of marks) {
        const kind = kindOf(mark);
        const existing = kind === 'translation' ? [] : await this.existingSenses(userId, kind, page.book.sourceLanguage, mark.normalForm ?? mark.text);
        toExplain.push({ markId: mark.id, kind, senseIds: existing.map((sense) => sense.sense_id) });
        promptMarks.push({
          mark_id: mark.id,
          kind,
          text: mark.text,
          dictionary_form: kind === 'translation' ? null : toNormalForm(mark.normalForm ?? mark.text),
          sentence: mark.sentence,
          existing_senses: existing,
        });
      }

      const output = await this.ai.generate({
        purpose: 'explain',
        system: EXPLANATION_SYSTEM_PROMPT,
        prompt: explanationUserPrompt(promptMarks),
        schema: explanationOutputSchema(toExplain),
        userId,
        pageId,
      });
      const results = toExplainResults(output.results);

      await this.prisma
        .$transaction(async (tx) => {
          await saveResults(tx, userId, pageId, results, new Map(toExplain.map((mark) => [mark.markId, mark.senseIds])));
          if (!(await movePage(tx, pageId, 'EXPLAINING', 'DONE'))) throw new PageMovedOnError();
        })
        .catch((error: unknown) => {
          if (!(error instanceof PageMovedOnError)) throw error;
        });
    } catch (error) {
      this.logger.warn(`Explanation attempt ${job.attemptsMade + 1} for page ${pageId} failed: ${String(error)}`);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const reason = error instanceof AiOutputInvalidError ? COULD_NOT_EXPLAIN : RETRY_LATER;
        await movePage(this.prisma, pageId, 'EXPLAINING', 'FAILED', { failedStage: 'EXPLAINING', failureReason: reason });
      }
      throw error;
    }
  }

  /**
   * Word and grammar marks the reader added or retyped may have no dictionary
   * form or sentence. One call reads them from the photo. A sentence that
   * cannot be found becomes the marked text. Saved on the marks, so a retry
   * does not ask again.
   */
  private async resolveMissing(marks: Mark[], photoKey: string, photoDeleted: boolean, userId: string, pageId: string): Promise<Mark[]> {
    const missing = marks.filter((mark) => kindOf(mark) !== 'translation' && (!mark.normalForm?.trim() || !mark.sentence?.trim()));
    if (missing.length === 0) return marks;

    let resolved = new Map<string, { normal_form: string; sentence: string | null }>();
    if (!photoDeleted) {
      const output = await this.ai.generate({
        purpose: 'resolve',
        system: RESOLVE_SYSTEM_PROMPT,
        prompt: resolveUserPrompt(missing.map((mark) => ({ mark_id: mark.id, kind: kindOf(mark) as WordOrGrammar, text: mark.text }))),
        schema: resolveOutputSchema(missing.map((mark) => mark.id)),
        imageJpeg: await this.photos.get(photoKey),
        userId,
        pageId,
      });
      resolved = new Map(output.marks.map((mark) => [mark.mark_id, mark]));
    }

    const updated = new Map<string, Mark>();
    for (const mark of missing) {
      const found = resolved.get(mark.id);
      const normalForm = mark.normalForm?.trim() || (found ? toNormalForm(found.normal_form) : mark.text);
      const sentence = mark.sentence?.trim() || found?.sentence?.trim() || mark.text;
      updated.set(mark.id, await this.prisma.mark.update({ where: { id: mark.id }, data: { normalForm, sentence } }));
    }
    return marks.map((mark) => updated.get(mark.id) ?? mark);
  }

  /** The reader's senses for this dictionary form, which the model may match instead of explaining again. */
  private async existingSenses(userId: string, kind: WordOrGrammar, language: string, normalForm: string) {
    const senses = await this.prisma.sense.findMany({
      where: { item: { userId, kind, language, normalForm: toNormalForm(normalForm) } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, meaning: true },
    });
    return senses.map((sense) => ({ sense_id: sense.id, meaning: sense.meaning }));
  }
}

class PageMovedOnError extends Error {}
