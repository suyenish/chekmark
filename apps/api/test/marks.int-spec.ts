import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { UsageService } from '../src/accounts/usage.service.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import type { FailedStage, MarkSource, MarkType, PageStatus } from '../src/generated/prisma/client.js';
import { PAGE_QUEUE } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakePageQueue } from './helpers/fake-page-queue.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

type Agent = ReturnType<typeof request.agent>;
type MarkSeed = { type: MarkType; text: string; normalForm?: string | null; source?: MarkSource };

describe('Mark check', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let redisClient: Redis;
  let app: INestApplication;
  let prisma: PrismaService;
  let usage: UsageService;
  const mailer = new LogMailer();
  const queue = new FakePageQueue();
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

  /** A page in `status` with marks in the given order, as detection would leave it. */
  async function createPage(status: PageStatus = 'AWAITING_CHECK', marks: MarkSeed[] = [], extra: { failedStage?: FailedStage; photoDeletedAt?: Date } = {}) {
    const page = await prisma.page.create({
      data: { bookId, pageNumber: 9, photoKey: `users/${ownerId}/pages/${crypto.randomUUID()}.jpg`, status, ...extra },
    });
    await prisma.mark.createMany({
      data: marks.map((mark, order) => ({
        pageId: page.id,
        order,
        type: mark.type,
        text: mark.text,
        normalForm: mark.normalForm ?? (mark.type === 'underline_save' || mark.type === 'curly' ? mark.text : null),
        sentence: `${mark.text}가 있는 문장.`,
        source: mark.source ?? 'detected',
      })),
    });
    const rows = await prisma.mark.findMany({ where: { pageId: page.id }, orderBy: { order: 'asc' } });
    return { page, marks: rows };
  }

  const markRow = (id: string) => prisma.mark.findUniqueOrThrow({ where: { id } });
  const pageRow = (id: string) => prisma.page.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    redisClient = new Redis(redis.url);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url, ALLOWED_EMAILS: `${OWNER},${OTHER}` }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(PHOTO_STORE)
      .useValue(new MemoryPhotoStore())
      .overrideProvider(PAGE_QUEUE)
      .useValue(queue)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    prisma = app.get(PrismaService);
    usage = app.get(UsageService);
    owner = await signIn(OWNER);
    other = await signIn(OTHER);
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER } })).id;
    bookId = (await prisma.book.create({ data: { userId: ownerId, title: 'Almond' } })).id;
  });

  afterAll(async () => {
    await app?.close();
    redisClient?.disconnect();
    await db?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    queue.clear();
    await redisClient.flushall();
    await prisma.aiCall.deleteMany();
  });

  describe('listing', () => {
    it('lists marks in page order with what the web app needs', async () => {
      const { page } = await createPage('AWAITING_CHECK', [
        { type: 'underline_save', text: '끄트머리' },
        { type: 'underline_translate', text: '너무나 기뻤다.' },
        { type: 'curly', text: '비록' },
      ]);
      const response = await owner.get(`/pages/${page.id}/marks`).expect(200);
      expect(response.body.map((m: { text: string; saved: boolean }) => [m.text, m.saved])).toEqual([
        ['끄트머리', true],
        ['너무나 기뻤다.', false],
        ['비록', true],
      ]);
      expect(response.body[0]).toMatchObject({ id: expect.any(String), type: 'underline_save', normalForm: '끄트머리', source: 'detected' });
    });
  });

  describe('editing', () => {
    it('changing a mark type sets source to corrected', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_save', text: '비록' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ type: 'curly' }).expect(200);
      // A word's dictionary form is not a grammar pattern: it is cleared for the explanation step to find again.
      expect(response.body).toMatchObject({ type: 'curly', source: 'corrected', normalForm: null });
      expect(await markRow(marks[0].id)).toMatchObject({ type: 'curly', source: 'corrected' });
    });

    it('resolves an unclear mark by choosing a type, leaving the dictionary form for the explanation step', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'unclear', text: '평평' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ type: 'underline_save' }).expect(200);
      expect(response.body).toMatchObject({ type: 'underline_save', normalForm: null, source: 'corrected' });
    });

    it('clears the dictionary form when the text changes without a new one', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_save', text: '겁먹', normalForm: '겁먹다' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ text: '겁먹고' }).expect(200);
      expect(response.body).toMatchObject({ text: '겁먹고', normalForm: null });
    });

    it('keeps the dictionary form when only the sentence changes', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_save', text: '겁먹고', normalForm: '겁먹다' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ sentence: '그는 겁먹고 도망쳤다.' }).expect(200);
      expect(response.body).toMatchObject({ normalForm: '겁먹다', sentence: '그는 겁먹고 도망쳤다.' });
    });

    it('refuses to set a mark to unclear', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'curly', text: '비록' }]);
      await owner.patch(`/marks/${marks[0].id}`).send({ type: 'unclear' }).expect(400);
    });

    it('turning saving off changes an underline to underline_translate and clears normal_form', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_save', text: '끄트머리', normalForm: '끄트머리' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ save: false }).expect(200);
      expect(response.body).toMatchObject({ type: 'underline_translate', normalForm: null, saved: false, source: 'corrected' });
    });

    it('turning saving on changes an underline to underline_save', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_translate', text: '들어갔고' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ save: true, normalForm: '들어가다' }).expect(200);
      expect(response.body).toMatchObject({ type: 'underline_save', normalForm: '들어가다', saved: true });
    });

    it('refuses the save switch on a curly or unclear mark, and type with save together', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [
        { type: 'curly', text: '비록' },
        { type: 'unclear', text: '평평' },
        { type: 'underline_save', text: '겁먹고' },
      ]);
      await owner.patch(`/marks/${marks[0].id}`).send({ save: false }).expect(400);
      await owner.patch(`/marks/${marks[1].id}`).send({ save: true }).expect(400);
      await owner.patch(`/marks/${marks[2].id}`).send({ type: 'curly', save: false }).expect(400);
      await owner.patch(`/marks/${marks[2].id}`).send({}).expect(400);
    });

    it('edits the text and dictionary form, and keeps an added mark as added', async () => {
      const { marks } = await createPage('AWAITING_CHECK', [{ type: 'underline_save', text: '겁먹', source: 'added' }]);
      const response = await owner.patch(`/marks/${marks[0].id}`).send({ text: ' 겁먹고 ', normalForm: '겁먹다' }).expect(200);
      expect(response.body).toMatchObject({ text: '겁먹고', normalForm: '겁먹다', source: 'added' });
    });

    it('deletes a mark', async () => {
      const { page, marks } = await createPage('AWAITING_CHECK', [
        { type: 'curly', text: '비록' },
        { type: 'unclear', text: '평평' },
      ]);
      await owner.delete(`/marks/${marks[1].id}`).expect(204);
      expect((await owner.get(`/pages/${page.id}/marks`).expect(200)).body).toHaveLength(1);
    });

    it('adding a mark sets source to added and places it last', async () => {
      const { page } = await createPage('AWAITING_CHECK', [
        { type: 'underline_translate', text: '너무나 기뻤다.' },
        { type: 'curly', text: '비록' },
      ]);
      const added = await owner
        .post(`/pages/${page.id}/marks`)
        .send({ type: 'underline_save', text: '기뻤다', sentence: '너무나 기뻤다.' })
        .expect(201);
      expect(added.body).toMatchObject({ type: 'underline_save', text: '기뻤다', normalForm: null, source: 'added', saved: true });
      const list = (await owner.get(`/pages/${page.id}/marks`).expect(200)).body as { id: string }[];
      expect(list.at(-1)!.id).toBe(added.body.id);
    });

    it('refuses an added mark with no text or an unclear type', async () => {
      const { page } = await createPage();
      await owner.post(`/pages/${page.id}/marks`).send({ type: 'curly', text: '  ' }).expect(400);
      await owner.post(`/pages/${page.id}/marks`).send({ type: 'unclear', text: '평평' }).expect(400);
    });

    it('refuses edits unless the page is AWAITING_CHECK with 409', async () => {
      for (const status of ['DETECTING', 'EXPLAINING', 'DONE'] as const) {
        const { page, marks } = await createPage(status, [{ type: 'curly', text: '비록' }]);
        await owner.patch(`/marks/${marks[0].id}`).send({ type: 'underline_save' }).expect(409);
        await owner.delete(`/marks/${marks[0].id}`).expect(409);
        await owner.post(`/pages/${page.id}/marks`).send({ type: 'curly', text: '뿐' }).expect(409);
        expect(await markRow(marks[0].id)).toMatchObject({ type: 'curly', source: 'detected' });
      }
    });
  });

  describe('confirm', () => {
    it('refuses confirm with 409 while any mark is unclear', async () => {
      const { page } = await createPage('AWAITING_CHECK', [
        { type: 'curly', text: '비록' },
        { type: 'unclear', text: '평평' },
      ]);
      const response = await owner.post(`/pages/${page.id}/confirm`).expect(409);
      expect(response.body.message).toMatch(/unclear/i);
      expect((await pageRow(page.id)).status).toBe('AWAITING_CHECK');
      expect(queue.explanation).toEqual([]);
    });

    it('confirm moves to EXPLAINING and queues one job', async () => {
      const { page } = await createPage('AWAITING_CHECK', [{ type: 'curly', text: '비록' }]);
      const response = await owner.post(`/pages/${page.id}/confirm`).expect(200);
      expect(response.body).toMatchObject({ id: page.id, status: 'EXPLAINING' });
      expect(queue.explanation).toEqual([page.id]);
    });

    it('a second confirm returns 409 and queues nothing', async () => {
      const { page } = await createPage('AWAITING_CHECK', [{ type: 'curly', text: '비록' }]);
      const [first, second] = await Promise.all([
        owner.post(`/pages/${page.id}/confirm`),
        owner.post(`/pages/${page.id}/confirm`),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      expect(queue.explanation).toEqual([page.id]);
      await owner.post(`/pages/${page.id}/confirm`).expect(409);
      expect(queue.explanation).toEqual([page.id]);
    });

    it('confirm with no marks moves straight to DONE without an AI call', async () => {
      const { page } = await createPage('AWAITING_CHECK', []);
      const response = await owner.post(`/pages/${page.id}/confirm`).expect(200);
      expect(response.body.status).toBe('DONE');
      expect(queue.explanation).toEqual([]);
      expect(await prisma.aiCall.count()).toBe(0);
    });
  });

  describe('retry', () => {
    it('retry after a detection failure re-queues detection', async () => {
      const { page } = await createPage('FAILED', [], { failedStage: 'DETECTING' });
      const response = await owner.post(`/pages/${page.id}/retry`).expect(200);
      expect(response.body).toMatchObject({ status: 'UPLOADED', failedStage: null, failureReason: null });
      expect(queue.detection).toEqual([page.id]);
      expect(await usage.used(ownerId, new Date())).toBe(1); // a detection retry counts as a page again
    });

    it('a detection retry respects the daily limit', async () => {
      for (let i = 0; i < 5; i++) await usage.reserve(ownerId, new Date());
      const { page } = await createPage('FAILED', [], { failedStage: 'DETECTING' });
      await owner.post(`/pages/${page.id}/retry`).expect(429);
      expect((await pageRow(page.id)).status).toBe('FAILED');
      expect(queue.detection).toEqual([]);
    });

    it('retry after an explanation failure re-queues explanation', async () => {
      const { page } = await createPage('FAILED', [{ type: 'curly', text: '비록' }], { failedStage: 'EXPLAINING' });
      const response = await owner.post(`/pages/${page.id}/retry`).expect(200);
      expect(response.body.status).toBe('EXPLAINING');
      expect(queue.explanation).toEqual([page.id]);
      expect(queue.detection).toEqual([]);
      expect(await usage.used(ownerId, new Date())).toBe(0);
    });

    it('retry on a page that is not FAILED returns 409', async () => {
      for (const status of ['UPLOADED', 'AWAITING_CHECK', 'DONE'] as const) {
        const { page } = await createPage(status);
        await owner.post(`/pages/${page.id}/retry`).expect(409);
      }
      expect(queue.detection).toEqual([]);
    });

    it('retry needing a deleted photo returns 409 with a request to upload again', async () => {
      const { page } = await createPage('FAILED', [], { failedStage: 'DETECTING', photoDeletedAt: new Date() });
      const response = await owner.post(`/pages/${page.id}/retry`).expect(409);
      expect(response.body.message).toMatch(/upload/i);
      expect(queue.detection).toEqual([]);
      expect(await usage.used(ownerId, new Date())).toBe(0);
    });

    it('retry is paused with 503 when the monthly budget is reached', async () => {
      await prisma.aiCall.create({ data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 20, durationMs: 1 } });
      const { page } = await createPage('FAILED', [], { failedStage: 'DETECTING' });
      await owner.post(`/pages/${page.id}/retry`).expect(503);
      expect((await pageRow(page.id)).status).toBe('FAILED');
    });
  });

  it("returns 404 for another user's page or mark", async () => {
    const { page, marks } = await createPage('AWAITING_CHECK', [{ type: 'curly', text: '비록' }]);
    await other.get(`/pages/${page.id}/marks`).expect(404);
    await other.patch(`/marks/${marks[0].id}`).send({ type: 'underline_save' }).expect(404);
    await other.delete(`/marks/${marks[0].id}`).expect(404);
    await other.post(`/pages/${page.id}/marks`).send({ type: 'curly', text: '뿐' }).expect(404);
    await other.post(`/pages/${page.id}/confirm`).expect(404);
    await other.post(`/pages/${page.id}/retry`).expect(404);
    await owner.patch('/marks/not-an-id').send({ type: 'curly' }).expect(404);
    expect(await markRow(marks[0].id)).toMatchObject({ type: 'curly', source: 'detected' });
    expect((await pageRow(page.id)).status).toBe('AWAITING_CHECK');
  });
});
