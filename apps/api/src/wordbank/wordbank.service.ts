import { Injectable, NotFoundException } from '@nestjs/common';
import type { ItemKind, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toNormalForm } from './normal-form.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SenseEdit = { senseId: string; meaning?: string; notes?: string | null; example?: string | null; exampleTranslation?: string | null };

const itemDetail = {
  senses: {
    orderBy: { createdAt: 'asc' },
    include: { sightings: { orderBy: { createdAt: 'asc' }, include: { page: { include: { book: true } } } } },
  },
} satisfies Prisma.ItemInclude;

type ItemWithDetail = Prisma.ItemGetPayload<{ include: typeof itemDetail }>;

/** The reader's saved words and grammar. Someone else's item is treated as missing (404). */
@Injectable()
export class WordbankService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first. `q` matches the dictionary form or a meaning, ignoring case and Unicode form. */
  async list(userId: string, filter: { q?: string; kind?: ItemKind }) {
    const q = filter.q ? toNormalForm(filter.q) : '';
    const items = await this.prisma.item.findMany({
      where: {
        userId,
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(q
          ? {
              OR: [
                { normalForm: { contains: q, mode: 'insensitive' } },
                { senses: { some: { meaning: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { senses: { orderBy: { createdAt: 'asc' }, select: { meaning: true, _count: { select: { sightings: true } } } } },
    });
    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      normalForm: item.normalForm,
      meanings: item.senses.map((sense) => sense.meaning),
      sightingCount: item.senses.reduce((sum, sense) => sum + sense._count.sightings, 0),
      createdAt: item.createdAt,
    }));
  }

  async get(userId: string, itemId: string) {
    return this.view(await this.find(userId, itemId));
  }

  /** Edits one sense of the item: its meaning, notes or example. */
  async editSense(userId: string, itemId: string, edit: SenseEdit) {
    const item = await this.find(userId, itemId);
    if (!item.senses.some((sense) => sense.id === edit.senseId)) throw new NotFoundException('Meaning not found on this item');
    const { senseId, ...data } = edit;
    await this.prisma.sense.update({ where: { id: senseId }, data });
    return this.get(userId, itemId);
  }

  /** Removes the item with its senses, sightings and cards. The page's marks and results stay. */
  async delete(userId: string, itemId: string): Promise<void> {
    await this.find(userId, itemId);
    await this.prisma.item.delete({ where: { id: itemId } });
  }

  private async find(userId: string, itemId: string): Promise<ItemWithDetail> {
    const item = UUID.test(itemId) ? await this.prisma.item.findFirst({ where: { id: itemId, userId }, include: itemDetail }) : null;
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  private view(item: ItemWithDetail) {
    return {
      id: item.id,
      kind: item.kind,
      normalForm: item.normalForm,
      createdAt: item.createdAt,
      senses: item.senses.map((sense) => ({
        id: sense.id,
        meaning: sense.meaning,
        notes: sense.notes,
        example: sense.example,
        exampleTranslation: sense.exampleTranslation,
        sightings: sense.sightings.map((sighting) => ({
          id: sighting.id,
          bookId: sighting.page.book.id,
          bookTitle: sighting.page.book.title,
          pageId: sighting.pageId,
          pageNumber: sighting.page.pageNumber,
          sentence: sighting.sentence,
          sentenceTranslation: sighting.sentenceTranslation,
          createdAt: sighting.createdAt,
        })),
      })),
    };
  }
}
