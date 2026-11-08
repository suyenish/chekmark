import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { DailyLimitReachedError, UsageService } from '../src/accounts/usage.service.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { PAGE_QUEUE } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakePageQueue } from './helpers/fake-page-queue.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const READER = 'reader@example.com';
const OWNER = 'owner@example.com';
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1)]);

async function startApp(dbUrl: string, redisUrl: string, mailer: LogMailer, photos = new MemoryPhotoStore()) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: dbUrl, REDIS_URL: redisUrl, ALLOWED_EMAILS: READER, OWNER_EMAIL: OWNER }))
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(PHOTO_STORE)
    .useValue(photos)
    .overrideProvider(PAGE_QUEUE)
    .useValue(new FakePageQueue())
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.listen(0);
  await request(app.getHttpServer()).post('/auth/request-link').send({ email: READER }).expect(202);
  const token = new URL(mailer.sent.at(-1)!.url).searchParams.get('token')!;
  const agent = request.agent(app.getHttpServer());
  await agent.post('/auth/verify').send({ token }).expect(200);
  const book = (await agent.post('/books').send({ title: 'Almond' }).expect(201)).body as { id: string };
  const upload = () => agent.post(`/books/${book.id}/pages`).field('pageNumber', '3').attach('photo', jpeg(), 'page.jpg');
  return { app, upload, bookId: book.id };
}

describe('daily page limit and monthly AI budget', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let redisClient: Redis;
  const mailer = new LogMailer();
  const photos = new MemoryPhotoStore();
  let app: INestApplication;
  let upload: () => request.Test;
  let bookId: string;
  let prisma: PrismaService;
  let usage: UsageService;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    redisClient = new Redis(redis.url);
    ({ app, upload, bookId } = await startApp(db.url, redis.url, mailer, photos));
    prisma = app.get(PrismaService);
    usage = app.get(UsageService);
  });

  afterAll(async () => {
    await app?.close();
    redisClient?.disconnect();
    await db?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    await redisClient.flushall();
    await prisma.aiCall.deleteMany();
    mailer.alerts.length = 0;
  });

  it('rejects the sixth page in a UTC day with 429 and the reset time', async () => {
    for (let i = 0; i < 5; i++) await upload().expect(201);
    const pagesBefore = await prisma.page.count({ where: { bookId } });

    const response = await upload().expect(429);
    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 0, 0, 0);
    expect(response.body.resetAt).toBe(nextMidnight.toISOString());
    expect(response.body.message).toMatch(/5 pages/);
    expect(await prisma.page.count({ where: { bookId } })).toBe(pagesBefore); // the photo is not processed
  });

  it('allows pages again after the UTC day changes', async () => {
    const user = (await prisma.user.findUniqueOrThrow({ where: { email: READER } })).id;
    const lateOnDay1 = new Date('2026-11-08T23:59:00Z');
    for (let i = 0; i < 5; i++) await usage.reserve(user, lateOnDay1);
    await expect(usage.reserve(user, lateOnDay1)).rejects.toMatchObject({
      resetAt: new Date('2026-11-09T00:00:00Z'),
    });
    await expect(usage.reserve(user, lateOnDay1)).rejects.toBeInstanceOf(DailyLimitReachedError);

    await expect(usage.reserve(user, new Date('2026-11-09T00:00:01Z'))).resolves.toBeUndefined();
    expect(await usage.used(user, lateOnDay1)).toBe(5); // refused attempts are not counted
    const ttl = await redisClient.ttl(`usage:${user}:2026-11-08`);
    expect(ttl).toBeGreaterThan(47 * 3600);
    expect(ttl).toBeLessThanOrEqual(48 * 3600);
  });

  it('gives a page back on release, never going below zero', async () => {
    const user = (await prisma.user.findUniqueOrThrow({ where: { email: READER } })).id;
    const day = new Date('2026-11-10T08:00:00Z');
    await usage.release(user, day);
    expect(await usage.used(user, day)).toBe(0);
    for (let i = 0; i < 5; i++) await usage.reserve(user, day);
    await usage.release(user, day);
    expect(await usage.used(user, day)).toBe(4);
    await expect(usage.reserve(user, day)).resolves.toBeUndefined();
  });

  it('pauses new pages with 503 when the cost this month reaches the budget', async () => {
    await prisma.aiCall.create({
      data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 20, durationMs: 1 },
    });
    const pagesBefore = await prisma.page.count();
    const photosBefore = photos.photos.size;

    const response = await upload().expect(503);
    expect(response.body.message).toMatch(/paused/);
    expect(await prisma.page.count()).toBe(pagesBefore);
    expect(photos.photos.size).toBe(photosBefore);
  });

  it('counts only the current UTC month towards the budget', async () => {
    await prisma.aiCall.create({
      data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 25, durationMs: 1, createdAt: new Date('2026-10-31T23:59:59Z') },
    });
    await prisma.aiCall.create({
      data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 19.99, durationMs: 1, createdAt: new Date('2026-11-01T00:00:00Z') },
    });
    expect(await usage.isBudgetReached(new Date('2026-11-15T00:00:00Z'))).toBe(false);
    await prisma.aiCall.create({
      data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 0.01, durationMs: 1, createdAt: new Date('2026-11-02T00:00:00Z') },
    });
    expect(await usage.isBudgetReached(new Date('2026-11-15T00:00:00Z'))).toBe(true);
  });

  it('alerts the owner once per month when the budget is reached', async () => {
    await prisma.aiCall.create({
      data: { purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 21, durationMs: 1 },
    });
    await upload().expect(503);
    await upload().expect(503);
    expect(mailer.alerts).toHaveLength(1);
    expect(mailer.alerts[0]).toMatchObject({ to: OWNER, subject: expect.stringMatching(/budget/i) });
    expect(mailer.alerts[0].text).toMatch(/\$20/);

    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    await usage.alertBudgetReached(nextMonth);
    expect(mailer.alerts).toHaveLength(2);
  });

  it('allows the upload and logs a warning when Redis cannot count usage', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const offline = await startApp(db.url, 'redis://127.0.0.1:1', new LogMailer());
    try {
      const page = (await offline.upload().expect(201)).body as { status: string };
      expect(page.status).toBe('UPLOADED');
      expect(warn.mock.calls.map(([message]) => String(message))).toEqual(
        expect.arrayContaining([expect.stringMatching(/could not count/i)]),
      );
    } finally {
      warn.mockRestore();
      await offline.app.close();
    }
  });
});
