import type { MarkType, PageStatus, PrismaClient } from '../../src/generated/prisma/client.js';
import { type ExplainResult, saveResults } from '../../src/wordbank/save-results.js';

export type SeedMark = {
  type: MarkType;
  text: string;
  normalForm?: string | null;
  sentence?: string;
  /** How the page's explanation turned out for this mark. */
  result:
    | { translation: string }
    | { meaning: string; notes?: string }
    | { sameAs: string /* sense meaning to reuse */ };
};

/**
 * Creates a page with marks and saves their explanations with the real
 * saveResults, so tests read exactly what the worker writes.
 */
export async function seedExplainedPage(
  prisma: PrismaClient,
  { userId, bookId, pageNumber, marks, status = 'DONE' }: { userId: string; bookId: string; pageNumber: number; marks: SeedMark[]; status?: PageStatus },
) {
  const page = await prisma.page.create({
    data: { bookId, pageNumber, photoKey: `users/${userId}/pages/${crypto.randomUUID()}.jpg`, status },
  });
  const rows = [];
  for (const [order, mark] of marks.entries()) {
    rows.push(
      await prisma.mark.create({
        data: {
          pageId: page.id,
          order,
          type: mark.type,
          text: mark.text,
          normalForm: mark.type === 'underline_translate' ? null : (mark.normalForm ?? mark.text),
          sentence: mark.sentence ?? `${mark.text} 문장.`,
          source: 'detected',
        },
      }),
    );
  }
  const results: ExplainResult[] = [];
  for (const [index, mark] of marks.entries()) {
    const markId = rows[index].id;
    if ('translation' in mark.result) results.push({ markId, kind: 'translation', translation: mark.result.translation });
    else if ('sameAs' in mark.result) {
      const sense = await prisma.sense.findFirstOrThrow({ where: { meaning: mark.result.sameAs, item: { userId } } });
      results.push({ markId, kind: 'existing', senseId: sense.id, sentenceTranslation: `${mark.text} in English.` });
    } else {
      results.push({
        markId,
        kind: 'new',
        meaning: mark.result.meaning,
        notes: mark.result.notes ?? 'A note.',
        example: '예문이에요.',
        exampleTranslation: 'It is an example.',
        sentenceTranslation: `${mark.text} in English.`,
      });
    }
  }
  if (status === 'DONE') await prisma.$transaction((tx) => saveResults(tx, userId, page.id, results));
  return { page, marks: rows };
}
