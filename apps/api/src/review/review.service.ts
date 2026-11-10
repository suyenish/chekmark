import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Rating, schedule } from './scheduler.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One session's worth. The web app asks again when it runs out. */
const DUE_LIMIT = 50;

/** Where the marked text sits in the sentence, or null if it cannot be found there. */
export function findHighlight(sentence: string, text: string): { text: string; start: number } | null {
  const haystack = sentence.normalize('NFC');
  const needle = text.normalize('NFC').trim();
  const start = needle ? haystack.indexOf(needle) : -1;
  return start === -1 ? null : { text: needle, start };
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cards due now, the longest-waiting first. The front is the sentence the
   * word or pattern was met in, with the marked text to highlight. If that
   * page was deleted, another sighting of the same meaning is used, then the
   * example sentence.
   */
  async due(userId: string, now: Date) {
    const cards = await this.prisma.card.findMany({
      where: { dueAt: { lte: now }, sense: { item: { userId } } },
      orderBy: { dueAt: 'asc' },
      take: DUE_LIMIT,
      include: {
        sighting: { include: { mark: true, page: { include: { book: true } } } },
        sense: {
          include: {
            item: true,
            sightings: { orderBy: { createdAt: 'asc' }, take: 1, include: { mark: true, page: { include: { book: true } } } },
          },
        },
      },
    });

    return cards.map((card) => {
      const sighting = card.sighting ?? card.sense.sightings[0] ?? null;
      // Composed form (NFC): the highlight position is measured in it, and the web app slices this same text.
      const sentence = (sighting?.sentence ?? card.sense.example ?? card.sense.item.normalForm).normalize('NFC');
      return {
        cardId: card.id,
        kind: card.sense.item.kind,
        normalForm: card.sense.item.normalForm,
        front: { sentence, highlight: sighting ? findHighlight(sentence, sighting.mark.text) : null },
        back: {
          meaning: card.sense.meaning,
          notes: card.sense.notes,
          example: card.sense.example,
          exampleTranslation: card.sense.exampleTranslation,
          sentenceTranslation: sighting?.sentenceTranslation ?? null,
        },
        source: sighting ? { bookTitle: sighting.page.book.title, pageNumber: sighting.page.pageNumber } : null,
      };
    });
  }

  async rate(userId: string, cardId: string, rating: Rating, now: Date) {
    const card = UUID.test(cardId) ? await this.prisma.card.findFirst({ where: { id: cardId, sense: { item: { userId } } } }) : null;
    if (!card) throw new NotFoundException('Card not found');
    const next = schedule(card, rating, now);
    const updated = await this.prisma.card.update({ where: { id: cardId }, data: { ...next, lastRating: rating } });
    return { cardId: updated.id, dueAt: updated.dueAt, intervalDays: updated.intervalDays, ease: updated.ease };
  }
}
