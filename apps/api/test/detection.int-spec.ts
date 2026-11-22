import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { UsageService } from '../src/accounts/usage.service.js';
import { AI_CLIENT, AiOutputInvalidError, AiTransientError } from '../src/ai/ai-client.js';
import { AiCallLogger } from '../src/ai/ai-call-logger.js';
import { FakeAiClient } from '../src/ai/fake-ai-client.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { DetectionProcessor } from '../src/detection/detection.processor.js';
import type { DetectionResult } from '../src/detection/detection.schema.js';
import type { PageStatus } from '../src/generated/prisma/client.js';
import { createRedisConnection, DETECTION_QUEUE, PAGE_JOB_OPTIONS } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkerModule } from '../src/worker.module.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const result = (marks: DetectionResult['marks'], usable = true, problem: string | null = null): DetectionResult => ({
  photo_usable: usable,
  problem,
  marks,
});

const MARKS: DetectionResult['marks'] = [
  { type: 'underline_save', text: '끄트머리', normal_form: '끄트머리', sentence: '나는 긴 줄의 끄트머리에 섰다.', box: [100, 200, 300, 230] },
  { type: 'curly', text: '비록', normal_form: '비록', sentence: '비록 늦게 왔지만 줄을 섰다.', box: [1200, 0, 50, 10] },
  { type: 'underline_translate', text: '너무나 기뻤다', normal_form: null, sentence: '마침내 표를 구했고 너무나 기뻤다.', box: null },
];

/** A job as the processor sees it. attemptsMade counts earlier failed attempts. */
const job = (pageId: string, attemptsMade = 0) => ({ data: { pageId }, attemptsMade, opts: { attempts: 3 } });

describe('detection job', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let redisClient: Redis;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let processor: DetectionProcessor;
  let usage: UsageService;
  let fake: FakeAiClient;
  const photos = new MemoryPhotoStore();
  let userId: string;
  let bookId: string;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    redisClient = new Redis(redis.url);
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url, AI_MODEL: 'claude-test' }))
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .overrideProvider(AI_CLIENT)
      .useFactory({
        inject: [AiCallLogger],
        factory: (logger: AiCallLogger) => {
          fake = new FakeAiClient({ nodeEnv: 'test', model: 'claude-test', onUsage: (u) => logger.log(u) });
          return fake;
        },
      })
      .compile();
    prisma = moduleRef.get(PrismaService);
    processor = moduleRef.get(DetectionProcessor);
    usage = moduleRef.get(UsageService);
    userId = (await prisma.user.create({ data: { email: 'reader@example.com' } })).id;
    bookId = (await prisma.book.create({ data: { userId, title: 'Almond' } })).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
    redisClient?.disconnect();
    await db?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    fake.clear();
    await redisClient.flushall();
  });

  async function createPage(status: PageStatus = 'UPLOADED') {
    const page = await prisma.page.create({ data: { bookId, pageNumber: 4, photoKey: `users/${userId}/pages/${crypto.randomUUID()}.jpg`, status } });
    await photos.put(page.photoKey, Buffer.from([0xff, 0xd8, 0xff, 9]));
    return page;
  }

  const marksOf = (pageId: string) => prisma.mark.findMany({ where: { pageId }, orderBy: { order: 'asc' } });
  const pageOf = (pageId: string) => prisma.page.findUniqueOrThrow({ where: { id: pageId } });

  it('stores detected marks in page order and moves the page to AWAITING_CHECK', async () => {
    const page = await createPage();
    fake.queue({ output: result(MARKS) });
    await processor.process(job(page.id));

    expect(fake.requests[0]).toMatchObject({ purpose: 'detect', userId, pageId: page.id });
    expect(fake.requests[0].imageJpeg).toEqual(Buffer.from([0xff, 0xd8, 0xff, 9]));
    const marks = await marksOf(page.id);
    expect(marks.map((m) => [m.order, m.type, m.text, m.normalForm, m.source])).toEqual([
      [0, 'underline_save', '끄트머리', '끄트머리', 'detected'],
      [1, 'curly', '비록', '비록', 'detected'],
      [2, 'underline_translate', '너무나 기뻤다', null, 'detected'],
    ]);
    expect(marks[0].sentence).toBe('나는 긴 줄의 끄트머리에 섰다.');
    expect(marks[0].position).toEqual([100, 200, 300, 230]);
    expect(marks[1].position).toBeNull(); // an impossible box is dropped, the mark is kept
    const updated = await pageOf(page.id);
    expect(updated.status).toBe('AWAITING_CHECK');
    expect(updated.detectionResult).toMatchObject({ photo_usable: true, marks: expect.any(Array) });
  });

  it('keeps a mark labelled unclear as unclear', async () => {
    const page = await createPage();
    fake.queue({ output: result([{ type: 'unclear', text: '평평', normal_form: null, sentence: '눈이 평평 내렸다.', box: null }]) });
    await processor.process(job(page.id));
    expect((await marksOf(page.id)).map((m) => m.type)).toEqual(['unclear']);
  });

  it('moves an unusable photo to FAILED with the problem text and releases the usage', async () => {
    const page = await createPage();
    await usage.reserve(userId, page.createdAt);
    fake.queue({ output: result([], false, 'The photo is too dark to read.') });
    await processor.process(job(page.id));

    expect(await pageOf(page.id)).toMatchObject({ status: 'FAILED', failedStage: 'DETECTING', failureReason: 'The photo is too dark to read.' });
    expect(await marksOf(page.id)).toEqual([]);
    expect(await usage.used(userId, page.createdAt)).toBe(0);
  });

  it('gives usage back to the day it was counted, for a page retried on a later day', async () => {
    const page = await createPage();
    const uploadedTwoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const retriedNow = new Date();
    await prisma.page.update({ where: { id: page.id }, data: { createdAt: uploadedTwoDaysAgo, statusChangedAt: retriedNow } });
    await usage.reserve(userId, retriedNow);
    fake.queue({ output: result([], false, 'The page is cut off.') });
    await processor.process(job(page.id));
    expect(await usage.used(userId, retriedNow)).toBe(0);
  });

  it('gives usage back to the day it was counted, for a stuck page whose detection restarted after midnight', async () => {
    const page = await createPage('DETECTING');
    const countedYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const restartedToday = new Date();
    await prisma.page.update({ where: { id: page.id }, data: { usageCountedAt: countedYesterday, statusChangedAt: restartedToday } });
    await usage.reserve(userId, countedYesterday);
    await usage.reserve(userId, restartedToday); // another page today, which must stay counted
    fake.queue({ output: result([], false, 'The page is cut off.') });
    await processor.process(job(page.id));
    expect(await usage.used(userId, countedYesterday)).toBe(0);
    expect(await usage.used(userId, restartedToday)).toBe(1);
  });

  it('replaces marks instead of duplicating them when the job runs twice', async () => {
    // A stuck page re-queued while still DETECTING, with marks from an earlier run.
    const page = await createPage('DETECTING');
    await prisma.mark.createMany({
      data: [0, 1, 2, 3].map((order) => ({ pageId: page.id, type: 'curly' as const, text: 'old', source: 'detected' as const, order })),
    });
    fake.queue({ output: result(MARKS) });
    await processor.process(job(page.id));
    expect((await marksOf(page.id)).map((m) => m.text)).toEqual(['끄트머리', '비록', '너무나 기뻤다']);

    // Running again after the page has moved on changes nothing and calls no AI.
    await processor.process(job(page.id));
    expect(fake.requests).toHaveLength(1);
    expect(await marksOf(page.id)).toHaveLength(3);
    expect((await pageOf(page.id)).status).toBe('AWAITING_CHECK');
  });

  it('moves to FAILED with failed_stage DETECTING after attempt 3 and releases the usage', async () => {
    const page = await createPage();
    await usage.reserve(userId, page.createdAt);
    fake.queue({ error: new AiTransientError('timeout') }, { error: new AiTransientError('timeout') }, { error: new AiTransientError('timeout') });

    await expect(processor.process(job(page.id, 0))).rejects.toBeInstanceOf(AiTransientError);
    await expect(processor.process(job(page.id, 1))).rejects.toBeInstanceOf(AiTransientError);
    expect(await pageOf(page.id)).toMatchObject({ status: 'DETECTING', failedStage: null });
    expect(await usage.used(userId, page.createdAt)).toBe(1);

    await expect(processor.process(job(page.id, 2))).rejects.toBeInstanceOf(AiTransientError);
    const failed = await pageOf(page.id);
    expect(failed).toMatchObject({ status: 'FAILED', failedStage: 'DETECTING' });
    expect(failed.failureReason).toMatch(/try again/i);
    expect(await usage.used(userId, page.createdAt)).toBe(0);
  });

  it('gives a plain reason when the model output stays invalid', async () => {
    const page = await createPage();
    fake.queue({ error: new AiOutputInvalidError('bad json') });
    await expect(processor.process(job(page.id, 2))).rejects.toBeInstanceOf(AiOutputInvalidError);
    expect((await pageOf(page.id)).failureReason).not.toMatch(/json/i);
  });

  it('does nothing for a page that was deleted before the job ran', async () => {
    await expect(processor.process(job(crypto.randomUUID()))).resolves.toBeUndefined();
    expect(fake.requests).toHaveLength(0);
  });

  it('logs model, tokens, cost and duration for every AI call', async () => {
    const page = await createPage();
    fake.queue({ output: result(MARKS), inputTokens: 1500, outputTokens: 400 });
    await processor.process(job(page.id));

    const calls = await prisma.aiCall.findMany({ where: { pageId: page.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId, purpose: 'detect', model: 'claude-test', inputTokens: 1500, outputTokens: 400 });
    // 1500 × $0.10 + 400 × $0.50 per million tokens
    expect(Number(calls[0].cost)).toBeCloseTo(0.00035, 8);
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs in the worker process: retries a failed attempt, then reads the page', async () => {
    const page = await createPage();
    fake.queue({ error: new AiTransientError('timeout') }, { output: result(MARKS) });
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url }))
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .overrideProvider(AI_CLIENT)
      .useValue(fake)
      .compile();
    const app = worker.createNestApplication();
    await app.init();
    const queue = new Queue(DETECTION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
    try {
      // The real options, with a short delay so the test does not wait 5 seconds.
      await queue.add('detect', { pageId: page.id }, { ...PAGE_JOB_OPTIONS, backoff: { type: 'fixed', delay: 50 }, jobId: `detect-${page.id}` });
      await expect.poll(async () => (await pageOf(page.id)).status, { timeout: 15_000 }).toBe('AWAITING_CHECK');
      expect(fake.requests).toHaveLength(2);
    } finally {
      await queue.close();
      await app.close();
    }
  });
});
