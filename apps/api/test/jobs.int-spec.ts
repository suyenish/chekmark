import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import type { PageStatus } from '../src/generated/prisma/client.js';
import { movePage } from '../src/jobs/page-status.js';
import {
  BullMqPageQueue,
  createRedisConnection,
  DETECTION_QUEUE,
  EXPLANATION_QUEUE,
  MAINTENANCE_QUEUE,
  PAGE_QUEUE,
  RedisUnavailableError,
  STUCK_PAGE_CHECK,
  scheduleStuckPageCheck,
} from '../src/jobs/queues.js';
import { requeueStuckPages, STUCK_AFTER_MS } from '../src/jobs/stuck-pages.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkerModule } from '../src/worker.module.js';
import { FakePageQueue } from './helpers/fake-page-queue.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const EMAIL = 'reader@example.com';
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 1)]);

describe('job queue and page status', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let prisma: PrismaService;
  let userId: string;
  let bookId: string;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    prisma = db.prisma as PrismaService;
    const user = await prisma.user.create({ data: { email: 'owner@example.com' } });
    userId = user.id;
    bookId = (await prisma.book.create({ data: { userId, title: 'Almond' } })).id;
  });

  afterAll(async () => {
    await db?.stop();
    await redis?.stop();
  });

  async function createPage(status: PageStatus = 'UPLOADED', statusChangedAt = new Date()) {
    return prisma.page.create({ data: { bookId, pageNumber: 1, photoKey: `users/${userId}/pages/x.jpg`, status, statusChangedAt } });
  }

  describe('movePage', () => {
    it('moves a page that is in the expected status and records when', async () => {
      const page = await createPage('UPLOADED', new Date('2026-01-01'));
      expect(await movePage(prisma, page.id, 'UPLOADED', 'DETECTING')).toBe(true);
      const moved = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
      expect(moved.status).toBe('DETECTING');
      expect(moved.statusChangedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('returns false and changes nothing when the page is not in the `from` status', async () => {
      const page = await createPage('AWAITING_CHECK');
      expect(await movePage(prisma, page.id, 'UPLOADED', 'DETECTING')).toBe(false);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).status).toBe('AWAITING_CHECK');
    });

    it('lets only one of two simultaneous moves succeed', async () => {
      const page = await createPage('UPLOADED');
      const results = await Promise.all([
        movePage(prisma, page.id, 'UPLOADED', 'DETECTING'),
        movePage(prisma, page.id, 'UPLOADED', 'DETECTING'),
      ]);
      expect(results.sort()).toEqual([false, true]);
    });

    it('throws for a move the rules do not allow', async () => {
      const page = await createPage('AWAITING_CHECK');
      await expect(movePage(prisma, page.id, 'AWAITING_CHECK', 'DONE')).rejects.toThrow(/AWAITING_CHECK → DONE/);
    });

    it('records the failed stage and reason, and clears them on retry', async () => {
      const page = await createPage('DETECTING');
      await movePage(prisma, page.id, 'DETECTING', 'FAILED', { failureReason: 'The AI service timed out' });
      let row = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
      expect(row).toMatchObject({ status: 'FAILED', failedStage: 'DETECTING', failureReason: 'The AI service timed out' });

      await movePage(prisma, page.id, 'FAILED', 'UPLOADED');
      row = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
      expect(row).toMatchObject({ status: 'UPLOADED', failedStage: null, failureReason: null });
    });
  });

  describe('BullMqPageQueue', () => {
    let connection: ReturnType<typeof createRedisConnection>;
    let pageQueue: BullMqPageQueue;
    let detection: Queue;
    let explanation: Queue;

    beforeAll(async () => {
      connection = createRedisConnection(redis.url, { forWorker: false });
      pageQueue = new BullMqPageQueue(connection);
      await pageQueue.waitUntilReady();
      detection = new Queue(DETECTION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      explanation = new Queue(EXPLANATION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
    });

    afterAll(async () => {
      await pageQueue?.close();
      await detection?.close();
      await explanation?.close();
      connection?.disconnect();
    });

    it('adding the same page twice creates one waiting job', async () => {
      await detection.obliterate({ force: true });
      await pageQueue.enqueueDetection('page-1');
      await pageQueue.enqueueDetection('page-1');
      expect(await detection.getWaitingCount()).toBe(1);
      expect((await detection.getWaiting()).map((job) => job.id)).toEqual(['detect-page-1']);

      await pageQueue.enqueueExplanation('page-1');
      await pageQueue.enqueueExplanation('page-1');
      expect((await explanation.getWaiting()).map((job) => job.id)).toEqual(['explain-page-1']);
    });

    it('uses 3 attempts with increasing delays', async () => {
      await pageQueue.enqueueDetection('page-2');
      const job = (await detection.getJob('detect-page-2'))!;
      expect(job.data).toEqual({ pageId: 'page-2' });
      expect(job.opts).toMatchObject({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    });

    it('schedules the stuck-page check every 5 minutes, once', async () => {
      const maintenance = new Queue(MAINTENANCE_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      try {
        await scheduleStuckPageCheck(maintenance);
        await scheduleStuckPageCheck(maintenance); // every worker start calls it
        const schedulers = await maintenance.getJobSchedulers();
        expect(schedulers).toHaveLength(1);
        expect(schedulers[0]).toMatchObject({ key: STUCK_PAGE_CHECK, every: 5 * 60 * 1000 });
      } finally {
        await maintenance.close();
      }
    });
  });

  it('refuses at once, without waiting, while Redis is not connected', async () => {
    const down = createRedisConnection('redis://127.0.0.1:1', { forWorker: false });
    down.on('error', () => undefined);
    const queue = new BullMqPageQueue(down);
    try {
      await expect(queue.enqueueDetection('page-x')).rejects.toBeInstanceOf(RedisUnavailableError);
    } finally {
      down.disconnect();
      await queue.close().catch(() => undefined);
    }
  });

  describe('requeueStuckPages', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const old = new Date(now.getTime() - STUCK_AFTER_MS - 1000);
    const recent = new Date(now.getTime() - STUCK_AFTER_MS + 60_000);
    const queue = new FakePageQueue();

    beforeEach(async () => {
      await prisma.page.deleteMany();
      queue.clear();
    });

    it('waits 10 minutes before calling a page stuck', () => {
      expect(STUCK_AFTER_MS).toBe(10 * 60 * 1000);
    });

    it('requeues UPLOADED, DETECTING and EXPLAINING pages unchanged for over 10 minutes', async () => {
      const uploaded = await createPage('UPLOADED', old);
      const detecting = await createPage('DETECTING', old);
      const explaining = await createPage('EXPLAINING', old);

      expect(await requeueStuckPages(prisma, queue, now)).toBe(3);
      expect(queue.detection.sort()).toEqual([uploaded.id, detecting.id].sort());
      expect(queue.explanation).toEqual([explaining.id]);
      // Status is left as it is: the job itself moves the page on.
      expect((await prisma.page.findUniqueOrThrow({ where: { id: detecting.id } })).status).toBe('DETECTING');
    });

    it('does not requeue recent pages, or AWAITING_CHECK, DONE and FAILED pages', async () => {
      await createPage('UPLOADED', recent);
      await createPage('DETECTING', recent);
      await createPage('EXPLAINING', recent);
      await createPage('AWAITING_CHECK', old);
      await createPage('DONE', old);
      await createPage('FAILED', old);

      expect(await requeueStuckPages(prisma, queue, now)).toBe(0);
      expect(queue.detection).toEqual([]);
      expect(queue.explanation).toEqual([]);
    });
  });

  describe('upload', () => {
    async function startApp(redisUrl: string) {
      const mailer = new LogMailer();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, ALLOWED_EMAILS: EMAIL, REDIS_URL: redisUrl }))
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(PHOTO_STORE)
        .useValue(new MemoryPhotoStore())
        .compile();
      const app: INestApplication = moduleRef.createNestApplication();
      await app.listen(0);
      await request(app.getHttpServer()).post('/auth/request-link').send({ email: EMAIL }).expect(202);
      const token = new URL(mailer.sent.at(-1)!.url).searchParams.get('token')!;
      const agent = request.agent(app.getHttpServer());
      await agent.post('/auth/verify').send({ token }).expect(200);
      const book = await agent.post('/books').send({ title: 'Almond' }).expect(201);
      const upload = () => agent.post(`/books/${book.body.id}/pages`).field('pageNumber', '5').attach('photo', jpeg(), 'page.jpg');
      return { app, upload };
    }

    it('queues detection for an uploaded page', async () => {
      const { app, upload } = await startApp(redis.url);
      await app.get<BullMqPageQueue>(PAGE_QUEUE).waitUntilReady();
      const detection = new Queue(DETECTION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      try {
        const page = (await upload().expect(201)).body as { id: string };
        expect(await detection.getJob(`detect-${page.id}`)).toBeDefined();
      } finally {
        await detection.close();
        await app.close();
      }
    });

    it('saves the page as UPLOADED and still returns 201 when Redis is unavailable', async () => {
      const { app, upload } = await startApp('redis://127.0.0.1:1'); // nothing listens on port 1
      try {
        const started = Date.now();
        const page = (await upload().expect(201)).body as { id: string; status: string };
        expect(Date.now() - started).toBeLessThan(5000);
        expect(page.status).toBe('UPLOADED');
        expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).status).toBe('UPLOADED');
      } finally {
        await app.close();
      }
    });
  });

  describe('worker process', () => {
    it('re-queues stuck pages when the stuck-page check runs', async () => {
      await prisma.page.deleteMany();
      const stuck = await createPage('UPLOADED', new Date(Date.now() - 11 * 60 * 1000));
      const worker = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url }))
        .compile();
      const context = worker.createNestApplication(); // runs the same start-up hooks as the worker process
      await context.init();
      const maintenance = new Queue(MAINTENANCE_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      const detection = new Queue(DETECTION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      try {
        expect((await maintenance.getJobSchedulers()).map((s) => s.key)).toContain(STUCK_PAGE_CHECK);
        await detection.obliterate({ force: true });
        await maintenance.add(STUCK_PAGE_CHECK, {});
        await expect.poll(async () => (await detection.getJob(`detect-${stuck.id}`))?.id, { timeout: 10_000 }).toBe(`detect-${stuck.id}`);
      } finally {
        await context.close();
        await maintenance.close();
        await detection.close();
      }
    });
  });
});
