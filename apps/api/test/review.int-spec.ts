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

describe('review', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new LogMailer();
  let owner: ReturnType<typeof request.agent>;
  let ownerId: string;
  let bookId: string;

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: 'redis://127.0.0.1:1', ALLOWED_EMAILS: OWNER }))
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
    await request(app.getHttpServer()).post('/auth/request-link').send({ email: OWNER }).expect(202);
    const token = new URL(mailer.sent.at(-1)!.url).searchParams.get('token')!;
    owner = request.agent(app.getHttpServer());
    await owner.post('/auth/verify').send({ token }).expect(200);
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

  const cardFor = (normalForm: string) => prisma.card.findFirstOrThrow({ where: { sense: { item: { normalForm } } } });

  it('returns only cards due now, oldest first', async () => {
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [
        { type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } },
        { type: 'underline_save', text: '겁먹고', normalForm: '겁먹다', result: { meaning: 'to get scared' } },
        { type: 'curly', text: '비록', result: { meaning: 'even though' } },
      ],
    });
    const hour = 60 * 60 * 1000;
    await prisma.card.update({ where: { id: (await cardFor('가까스로')).id }, data: { dueAt: new Date(Date.now() - 1 * hour) } });
    await prisma.card.update({ where: { id: (await cardFor('겁먹다')).id }, data: { dueAt: new Date(Date.now() - 5 * hour) } });
    await prisma.card.update({ where: { id: (await cardFor('비록')).id }, data: { dueAt: new Date(Date.now() + 5 * hour) } });

    const response = await owner.get('/review/due').expect(200);
    expect(response.body.map((card: { normalForm: string }) => card.normalForm)).toEqual(['겁먹다', '가까스로']);
  });

  it('returns the sentence and the text to highlight on the card front', async () => {
    const sentence = '그는 겁먹고 도망쳤다.';
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '겁먹고', normalForm: '겁먹다', sentence, result: { meaning: 'to get scared', notes: '겁 + 먹다' } }],
    });
    const [card] = (await owner.get('/review/due').expect(200)).body;
    expect(card).toMatchObject({
      cardId: expect.any(String),
      kind: 'word',
      normalForm: '겁먹다',
      front: { sentence, highlight: { text: '겁먹고', start: 3 } },
      back: { meaning: 'to get scared', notes: '겁 + 먹다', example: '예문이에요.', exampleTranslation: 'It is an example.', sentenceTranslation: '겁먹고 in English.' },
      source: { bookTitle: '아몬드', pageNumber: 1 },
    });
  });

  it('returns the highlight as null when the text is not found in the sentence', async () => {
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'curly', text: '섰을 뿐', normalForm: '-(으)ㄹ 뿐', sentence: '줄을 선 것뿐이다.', result: { meaning: 'only' } }],
    });
    const [card] = (await owner.get('/review/due').expect(200)).body;
    expect(card.front).toEqual({ sentence: '줄을 선 것뿐이다.', highlight: null });
  });

  it('finds the highlight when the sentence and text use different Unicode forms', async () => {
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '겁먹고'.normalize('NFD'), normalForm: '겁먹다', sentence: '그는 겁먹고 도망쳤다.', result: { meaning: 'to get scared' } }],
    });
    const [card] = (await owner.get('/review/due').expect(200)).body;
    expect(card.front.highlight).toEqual({ text: '겁먹고', start: 3 });
  });

  it('returns the sentence in the same Unicode form the highlight position was measured in', async () => {
    const sentence = '그는 겁먹고 도망쳤다.';
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '겁먹고', normalForm: '겁먹다', sentence: sentence.normalize('NFD'), result: { meaning: 'to get scared' } }],
    });
    const [card] = (await owner.get('/review/due').expect(200)).body;
    const { sentence: shown, highlight } = card.front;
    expect(shown).toBe(sentence); // composed, as the web app will slice it
    expect(shown.slice(highlight.start, highlight.start + highlight.text.length)).toBe('겁먹고');
  });

  it('keeps showing a card after its page is deleted, using another sighting or the example', async () => {
    const { page } = await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '가까스로', sentence: '그는 가까스로 탈출했다.', result: { meaning: 'barely' } }],
    });
    await prisma.page.delete({ where: { id: page.id } });
    const [card] = (await owner.get('/review/due').expect(200)).body;
    expect(card).toMatchObject({ normalForm: '가까스로', front: { sentence: '예문이에요.', highlight: null }, source: null });
  });

  it('schedules a card from its rating', async () => {
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } }],
    });
    const card = await cardFor('가까스로');
    const before = Date.now();
    const response = await owner.post(`/review/${card.id}`).send({ rating: 'easy' }).expect(200);
    expect(response.body).toMatchObject({ cardId: card.id, intervalDays: 3, ease: 2.55 });
    const due = new Date(response.body.dueAt).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ intervalDays: 3, ease: 2.55, lastRating: 'easy' });
    expect((await owner.get('/review/due').expect(200)).body).toEqual([]);
  });

  it('rejects a rating other than again, hard or easy with 400', async () => {
    await seedExplainedPage(prisma, {
      userId: ownerId,
      bookId,
      pageNumber: 1,
      marks: [{ type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } }],
    });
    const card = await cardFor('가까스로');
    for (const body of [{ rating: 'good' }, { rating: '' }, {}, { rating: 3 }]) {
      await owner.post(`/review/${card.id}`).send(body).expect(400);
    }
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ intervalDays: 0, lastRating: null });
  });
});
