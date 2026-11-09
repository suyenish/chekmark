import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LibraryService } from './library.service.js';

export interface SeenBefore {
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number | null;
  sentence: string;
}

export type PageResult =
  | { markId: string; kind: 'translation'; text: string; translation: string }
  | {
      markId: string;
      kind: 'word' | 'grammar';
      text: string;
      normalForm: string;
      itemId: string;
      senseId: string;
      meaning: string;
      notes: string | null;
      example: string | null;
      exampleTranslation: string | null;
      sentence: string;
      sentenceTranslation: string | null;
      /** Earlier places this meaning was met, oldest first: "You saw this on page 12". */
      seenBefore: SeenBefore[];
    };

/** What a finished page shows: one result per mark, in the order the marks are on the page. */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: LibraryService,
  ) {}

  async pageResults(userId: string, pageId: string): Promise<PageResult[]> {
    const page = await this.library.getPage(userId, pageId);
    if (page.status !== 'DONE') throw new ConflictException('This page is not finished yet.');

    const marks = await this.prisma.mark.findMany({
      where: { pageId },
      orderBy: { order: 'asc' },
      include: { translation: true, sighting: { include: { sense: { include: { item: true } } } } },
    });

    const results: PageResult[] = [];
    for (const mark of marks) {
      if (mark.translation) {
        results.push({ markId: mark.id, kind: 'translation', text: mark.text, translation: mark.translation.translatedText });
        continue;
      }
      const sighting = mark.sighting;
      if (!sighting) continue; // a mark with nothing saved, such as one whose item was deleted
      const { sense } = sighting;
      const earlier = await this.prisma.sighting.findMany({
        where: { senseId: sense.id, id: { not: sighting.id }, createdAt: { lte: sighting.createdAt }, pageId: { not: pageId } },
        orderBy: { createdAt: 'asc' },
        include: { page: { include: { book: true } } },
      });
      results.push({
        markId: mark.id,
        kind: sense.item.kind,
        text: mark.text,
        normalForm: sense.item.normalForm,
        itemId: sense.item.id,
        senseId: sense.id,
        meaning: sense.meaning,
        notes: sense.notes,
        example: sense.example,
        exampleTranslation: sense.exampleTranslation,
        sentence: sighting.sentence,
        sentenceTranslation: sighting.sentenceTranslation,
        seenBefore: earlier.map((s) => ({
          bookId: s.page.book.id,
          bookTitle: s.page.book.title,
          pageId: s.page.id,
          pageNumber: s.page.pageNumber,
          sentence: s.sentence,
        })),
      });
    }
    return results;
  }
}
