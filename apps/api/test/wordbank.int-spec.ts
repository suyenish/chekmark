import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { PAGE_QUEUE } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakePageQueue } from './helpers/fake-page-queue.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { seedExplainedPage } from './helpers/seed-wordbank.js';
import { startTestDb } from './helpers/test-db.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
const SENTENCE = '비록 긴 줄의 끄트머리에 섰을 뿐이지만, 어쨌거나 표를 구했고 너무나 기뻤다.';

type Agent = ReturnType<typeof request.agent>;

describe('results and the word bank', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new LogMailer();
  let owner: Agent;
  let other: Agent;
  let ownerId: string;
  let bookId: string;

  async function signIn(email: string) {
    await request(app.getHttpServer()).post('/auth/request-link').send({ email }).expect(202);
    const token = new URL(mailer.sent.at(-1)!.url).searchParams.get('token')!;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/verify').send({ token }).expect(200);
    return agent;
  }

  const seed = (pageNumber: number, marks: Parameters<typeof seedExplainedPage>[1]['marks'], status?: 'DONE' | 'EXPLAINING') =>
    seedExplainedPage(prisma, { userId: ownerId, bookId, pageNumber, marks, status });

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: 'redis://127.0.0.1:1', ALLOWED_EMAILS: `${OWNER},${OTHER}` }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(PHOTO_STORE)
      .useValue(new MemoryPhotoStore())
      .overrideProvider(PAGE_QUEUE)
      .useValue(new FakePageQueue())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    prisma = app.get(PrismaService);
    owner = await signIn(OWNER);
    other = await signIn(OTHER);
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER } })).id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  beforeEach(async () => {
    await prisma.item.deleteMany();
    await prisma.book.deleteMany();
    bookId = (await prisma.book.create({ data: { userId: ownerId, title: '아몬드' } })).id;
  });

  describe('GET /pages/:id/results', () => {
    it('returns results in mark order for all three kinds', async () => {
      const { page } = await seed(12, [
        { type: 'underline_translate', text: SENTENCE, sentence: SENTENCE, result: { translation: 'Although I was only a freshman...' } },
        { type: 'curly', text: '비록', normalForm: '비록', sentence: SENTENCE, result: { meaning: 'even though', notes: 'Starts a concession.' } },
        { type: 'underline_save', text: '끄트머리에', normalForm: '끄트머리', sentence: SENTENCE, result: { meaning: 'the very end' } },
      ]);
      const response = await owner.get(`/pages/${page.id}/results`).expect(200);
      expect(response.body.map((r: { kind: string }) => r.kind)).toEqual(['translation', 'grammar', 'word']);
      expect(response.body[0]).toMatchObject({ text: SENTENCE, translation: 'Although I was only a freshman...' });
      expect(response.body[1]).toMatchObject({
        text: '비록',
        normalForm: '비록',
        meaning: 'even though',
        notes: 'Starts a concession.',
        example: '예문이에요.',
        exampleTranslation: 'It is an example.',
        sentence: SENTENCE,
        sentenceTranslation: '비록 in English.',
        itemId: expect.any(String),
        seenBefore: [],
      });
      expect(response.body[2]).toMatchObject({ normalForm: '끄트머리', meaning: 'the very end' });
    });

    it('includes "seen before" with book, page and sentence on a repeated item', async () => {
      await seed(3, [{ type: 'underline_save', text: '가까스로', sentence: '그는 가까스로 탈출했다.', result: { meaning: 'barely' } }]);
      const { page } = await seed(12, [{ type: 'underline_save', text: '가까스로', sentence: '가까스로 시간에 맞췄다.', result: { sameAs: 'barely' } }]);
      const response = await owner.get(`/pages/${page.id}/results`).expect(200);
      expect(response.body[0]).toMatchObject({ meaning: 'barely', sentence: '가까스로 시간에 맞췄다.' });
      expect(response.body[0].seenBefore).toEqual([{ bookId, bookTitle: '아몬드', pageId: expect.any(String), pageNumber: 3, sentence: '그는 가까스로 탈출했다.' }]);
    });

    it('returns 409 for results before the page is DONE', async () => {
      const { page } = await seed(4, [{ type: 'curly', text: '비록', result: { meaning: 'even though' } }], 'EXPLAINING');
      await owner.get(`/pages/${page.id}/results`).expect(409);
    });
  });

  describe('word bank', () => {
    async function seedBank() {
      await seed(3, [
        { type: 'underline_save', text: '가까스로', sentence: '그는 가까스로 탈출했다.', result: { meaning: 'barely; with difficulty' } },
        { type: 'curly', text: '섰을 뿐', normalForm: '-(으)ㄹ 뿐', result: { meaning: 'only; nothing more than' } },
        { type: 'underline_save', text: '겁먹고', normalForm: '겁먹다', result: { meaning: 'to get scared' } },
      ]);
      await seed(7, [{ type: 'underline_save', text: '가까스로', sentence: '가까스로 시간에 맞췄다.', result: { sameAs: 'barely; with difficulty' } }]);
    }

    it('lists items, newest first, with their meanings and how often they were met', async () => {
      await seedBank();
      const response = await owner.get('/wordbank').expect(200);
      expect(response.body).toHaveLength(3);
      const barely = response.body.find((item: { normalForm: string }) => item.normalForm === '가까스로');
      expect(barely).toMatchObject({ kind: 'word', meanings: ['barely; with difficulty'], sightingCount: 2 });
    });

    it('searches the word bank by normal form and meaning', async () => {
      await seedBank();
      const forms = async (query: string) =>
        ((await owner.get(`/wordbank${query}`).expect(200)).body as { normalForm: string }[]).map((item) => item.normalForm).sort();
      expect(await forms('?q=가까스')).toEqual(['가까스로']);
      expect(await forms(`?q=${encodeURIComponent('가까스'.normalize('NFD'))}`)).toEqual(['가까스로']);
      expect(await forms('?q=SCARED')).toEqual(['겁먹다']);
      expect(await forms('?kind=grammar')).toEqual(['-(으)ㄹ 뿐']);
      expect(await forms('?q=only&kind=word')).toEqual([]);
      await owner.get('/wordbank?kind=noun').expect(400);
    });

    it('lists every sighting of an item', async () => {
      await seedBank();
      const item = await prisma.item.findFirstOrThrow({ where: { normalForm: '가까스로' } });
      const response = await owner.get(`/wordbank/${item.id}`).expect(200);
      expect(response.body).toMatchObject({ id: item.id, kind: 'word', normalForm: '가까스로' });
      expect(response.body.senses).toHaveLength(1);
      expect(response.body.senses[0]).toMatchObject({ meaning: 'barely; with difficulty', example: '예문이에요.' });
      expect(response.body.senses[0].sightings.map((s: { pageNumber: number; sentence: string; bookTitle: string }) => [s.bookTitle, s.pageNumber, s.sentence])).toEqual([
        ['아몬드', 3, '그는 가까스로 탈출했다.'],
        ['아몬드', 7, '가까스로 시간에 맞췄다.'],
      ]);
    });

    it('edits a sense meaning and notes', async () => {
      await seedBank();
      const item = await prisma.item.findFirstOrThrow({ where: { normalForm: '겁먹다' }, include: { senses: true } });
      const senseId = item.senses[0].id;
      const response = await owner.patch(`/wordbank/${item.id}`).send({ senseId, meaning: 'to be frightened', notes: '겁 + 먹다' }).expect(200);
      expect(response.body.senses[0]).toMatchObject({ id: senseId, meaning: 'to be frightened', notes: '겁 + 먹다' });
      await owner.patch(`/wordbank/${item.id}`).send({ senseId, meaning: '  ' }).expect(400);
      await owner.patch(`/wordbank/${item.id}`).send({ meaning: 'x' }).expect(400);
      // A sense of another item cannot be edited through this item.
      const other = await prisma.sense.findFirstOrThrow({ where: { itemId: { not: item.id } } });
      await owner.patch(`/wordbank/${item.id}`).send({ senseId: other.id, meaning: 'x' }).expect(404);
    });

    it('deleting an item removes its senses, sightings and cards', async () => {
      await seedBank();
      const item = await prisma.item.findFirstOrThrow({ where: { normalForm: '가까스로' } });
      await owner.delete(`/wordbank/${item.id}`).expect(204);
      await owner.get(`/wordbank/${item.id}`).expect(404);
      expect(await prisma.sense.count({ where: { itemId: item.id } })).toBe(0);
      expect(await prisma.sighting.count({ where: { sense: { itemId: item.id } } })).toBe(0);
      expect(await prisma.card.count()).toBe(2); // the other two items keep theirs
      expect(await prisma.mark.count({ where: { text: '가까스로' } })).toBe(2); // the page's marks stay
    });
  });

  it("returns 404 for another user's item, page or card", async () => {
    const { page } = await seed(3, [{ type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } }]);
    const item = await prisma.item.findFirstOrThrow();
    const card = await prisma.card.findFirstOrThrow();
    await other.get(`/pages/${page.id}/results`).expect(404);
    await other.get(`/wordbank/${item.id}`).expect(404);
    await other.patch(`/wordbank/${item.id}`).send({ senseId: card.senseId, meaning: 'x' }).expect(404);
    await other.delete(`/wordbank/${item.id}`).expect(404);
    await other.post(`/review/${card.id}`).send({ rating: 'easy' }).expect(404);
    expect((await other.get('/wordbank').expect(200)).body).toEqual([]);
    expect((await other.get('/review/due').expect(200)).body).toEqual([]);
    await owner.get('/wordbank/not-an-id').expect(404);
    expect(await prisma.item.count()).toBe(1);
  });
});
