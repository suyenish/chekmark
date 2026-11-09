import type { ItemKind, Prisma } from '../generated/prisma/client.js';
import { toNormalForm } from './normal-form.js';

export type ExplainResult =
  | { markId: string; kind: 'translation'; translation: string }
  | { markId: string; kind: 'existing'; senseId: string; sentenceTranslation: string }
  | {
      markId: string;
      kind: 'new';
      meaning: string;
      notes: string;
      example: string;
      exampleTranslation: string;
      sentenceTranslation: string;
    };

const itemKindOf = (type: string): ItemKind | null => (type === 'underline_save' ? 'word' : type === 'curly' ? 'grammar' : null);

/**
 * Saves a page's explanations into the word bank. Call it inside a
 * transaction: if any write fails, nothing is kept.
 *
 * - translation: a Translation row, no item or card.
 * - existing: a new sighting of a sense the reader already has, no new card.
 * - new: the item (found or created by dictionary form), a new sense, its
 *   sighting and a card showing that sighting. A second mark of the same word
 *   with the same meaning on this page reuses that sense, so it gets one card,
 *   showing the word's first sighting.
 *
 * Marks that already have a sighting or translation are skipped, so running
 * it twice saves nothing twice.
 */
export async function saveResults(tx: Prisma.TransactionClient, userId: string, pageId: string, results: ExplainResult[]): Promise<void> {
  const page = await tx.page.findUniqueOrThrow({ where: { id: pageId }, include: { book: { select: { sourceLanguage: true } } } });
  const marks = await tx.mark.findMany({
    where: { pageId },
    orderBy: { order: 'asc' },
    include: { sighting: { select: { id: true } }, translation: { select: { id: true } } },
  });
  const resultByMark = new Map(results.map((result) => [result.markId, result]));
  const sensesMadeHere = new Map<string, string>(); // `${itemId}|${meaning}` → sense ID
  const now = new Date();

  for (const mark of marks) {
    const result = resultByMark.get(mark.id);
    if (!result || mark.sighting || mark.translation) continue;

    if (result.kind === 'translation') {
      if (mark.type !== 'underline_translate') throw new Error(`Mark ${mark.id} is not a sentence to translate`);
      await tx.translation.create({ data: { pageId, markId: mark.id, translatedText: result.translation } });
      continue;
    }

    const kind = itemKindOf(mark.type);
    if (!kind) throw new Error(`Mark ${mark.id} cannot be saved to the word bank`);
    const sighting = { pageId, markId: mark.id, sentence: mark.sentence ?? mark.text, sentenceTranslation: result.sentenceTranslation };

    if (result.kind === 'existing') {
      const sense = await tx.sense.findFirst({ where: { id: result.senseId, item: { userId } } });
      if (!sense) throw new Error(`Sense ${result.senseId} is not in this reader's word bank`);
      await tx.sighting.create({ data: { ...sighting, senseId: sense.id } });
      continue;
    }

    const normalForm = toNormalForm(mark.normalForm ?? mark.text);
    const item = await tx.item.upsert({
      where: { userId_kind_language_normalForm: { userId, kind, language: page.book.sourceLanguage, normalForm } },
      create: { userId, kind, language: page.book.sourceLanguage, normalForm },
      update: {},
    });
    const key = `${item.id}|${result.meaning.trim().toLowerCase()}`;
    const reused = sensesMadeHere.get(key);
    if (reused) {
      await tx.sighting.create({ data: { ...sighting, senseId: reused } });
      continue;
    }
    const sense = await tx.sense.create({
      data: {
        itemId: item.id,
        meaning: result.meaning,
        notes: result.notes,
        example: result.example,
        exampleTranslation: result.exampleTranslation,
      },
    });
    sensesMadeHere.set(key, sense.id);
    const created = await tx.sighting.create({ data: { ...sighting, senseId: sense.id } });
    await tx.card.create({ data: { senseId: sense.id, sightingId: created.id, dueAt: now } });
  }
}
