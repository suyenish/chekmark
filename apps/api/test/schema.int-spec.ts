import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startTestDb } from './helpers/test-db.js';

describe('database schema', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestDb());
  });

  afterAll(async () => {
    await stop?.();
  });

  let counter = 0;
  const newUser = () => prisma.user.create({ data: { email: `reader${++counter}@example.com` } });

  async function newMark(userId: string) {
    const book = await prisma.book.create({ data: { userId, title: '책' } });
    const page = await prisma.page.create({ data: { bookId: book.id, photoKey: `photos/${book.id}.jpg` } });
    const mark = await prisma.mark.create({
      data: { pageId: page.id, type: 'underline_save', text: '사과를', source: 'detected', order: 0 },
    });
    return { book, page, mark };
  }

  async function newSense(userId: string, normalForm = '사과') {
    const item = await prisma.item.create({ data: { userId, kind: 'word', language: 'ko', normalForm } });
    return prisma.sense.create({ data: { itemId: item.id, meaning: 'apple' } });
  }

  it('starts a new user with English explanations', async () => {
    expect((await newUser()).explanationLanguage).toBe('en');
  });

  it('allows one item per user, kind, language and normal_form', async () => {
    const user = await newUser();
    const other = await newUser();
    const item = { kind: 'word' as const, language: 'ko', normalForm: '사과' };
    await prisma.item.create({ data: { ...item, userId: user.id } });

    await expect(prisma.item.create({ data: { ...item, userId: user.id } })).rejects.toThrow();
    await expect(prisma.item.create({ data: { ...item, userId: other.id } })).resolves.toBeDefined();
    await expect(prisma.item.create({ data: { ...item, kind: 'grammar', userId: user.id } })).resolves.toBeDefined();
  });

  it('allows one sighting per mark and one translation per mark', async () => {
    const user = await newUser();
    const { page, mark } = await newMark(user.id);
    const sense = await newSense(user.id);
    const sighting = { senseId: sense.id, pageId: page.id, markId: mark.id, sentence: '사과를 먹었다.' };
    await prisma.sighting.create({ data: sighting });
    await expect(prisma.sighting.create({ data: sighting })).rejects.toThrow();

    const translation = { pageId: page.id, markId: mark.id, translatedText: 'I ate an apple.' };
    await prisma.translation.create({ data: translation });
    await expect(prisma.translation.create({ data: translation })).rejects.toThrow();
  });

  it('allows one card per sense', async () => {
    const user = await newUser();
    const sense = await newSense(user.id);
    await prisma.card.create({ data: { senseId: sense.id, dueAt: new Date() } });
    await expect(prisma.card.create({ data: { senseId: sense.id, dueAt: new Date() } })).rejects.toThrow();
  });

  it('deleting a user removes all of their rows', async () => {
    const user = await newUser();
    const keep = await newUser();
    for (const owner of [user, keep]) {
      const { page, mark } = await newMark(owner.id);
      const sense = await newSense(owner.id);
      const sighting = await prisma.sighting.create({ data: { senseId: sense.id, pageId: page.id, markId: mark.id, sentence: 's' } });
      await prisma.translation.create({ data: { pageId: page.id, markId: mark.id, translatedText: 't' } });
      await prisma.card.create({ data: { senseId: sense.id, sightingId: sighting.id, dueAt: new Date() } });
      await prisma.aiCall.create({
        data: { userId: owner.id, pageId: page.id, purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 0.001, durationMs: 5 },
      });
      await prisma.session.create({ data: { userId: owner.id, tokenHash: `session-${owner.id}`, expiresAt: new Date() } });
    }

    await prisma.user.delete({ where: { id: user.id } });

    const owned = { userId: user.id };
    const counts = await Promise.all([
      prisma.book.count({ where: owned }),
      prisma.page.count({ where: { book: owned } }),
      prisma.mark.count({ where: { page: { book: owned } } }),
      prisma.item.count({ where: owned }),
      prisma.sense.count({ where: { item: owned } }),
      prisma.sighting.count({ where: { sense: { item: owned } } }),
      prisma.translation.count({ where: { page: { book: owned } } }),
      prisma.card.count({ where: { sense: { item: owned } } }),
      prisma.aiCall.count({ where: owned }),
      prisma.session.count({ where: owned }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await prisma.card.count({ where: { sense: { item: { userId: keep.id } } } })).toBe(1);
  });

  it('rejects a page status outside the five allowed values and FAILED', async () => {
    const user = await newUser();
    const { page } = await newMark(user.id);
    for (const status of ['UPLOADED', 'DETECTING', 'AWAITING_CHECK', 'EXPLAINING', 'DONE', 'FAILED']) {
      await prisma.$executeRawUnsafe(`UPDATE pages SET status = '${status}' WHERE id = '${page.id}'`);
    }
    await expect(prisma.$executeRawUnsafe(`UPDATE pages SET status = 'LOST' WHERE id = '${page.id}'`)).rejects.toThrow();
  });

  it('starts a page as UPLOADED with the time it changed', async () => {
    const user = await newUser();
    const { page } = await newMark(user.id);
    expect(page.status).toBe('UPLOADED');
    expect(page.statusChangedAt).toBeInstanceOf(Date);
  });
});
