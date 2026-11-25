import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AccountService } from '../src/accounts/account.service.js';
import { UsageService } from '../src/accounts/usage.service.js';
import { AppModule } from '../src/app.module.js';
import type { AiClient } from '../src/ai/ai-client.js';
import { DemoRoutingAiClient } from '../src/ai/demo-routing-ai-client.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { deleteExpiredDemos } from '../src/demo/demo-cleanup.js';
import { DEMO_LIFETIME_MS, DEMOS_PER_HOUR } from '../src/demo/demo.service.js';
import { ExplanationProcessor } from '../src/explanation/explanation.processor.js';
import { PAGE_QUEUE, type PageQueue } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

describe('demo accounts', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let redisClient: Redis;
  let app: INestApplication;
  let prisma: PrismaService;
  const photos = new MemoryPhotoStore();
  const queued: string[] = [];
  const queue = { enqueueDetection: async (id: string) => void queued.push(id), enqueueExplanation: async (id: string) => void queued.push(id) } as unknown as PageQueue;

  async function startApp(env: Record<string, string>) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url, ...env }))
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .overrideProvider(PAGE_QUEUE)
      .useValue(queue)
      .compile();
    const started = moduleRef.createNestApplication();
    await started.listen(0);
    return started;
  }

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    redisClient = new Redis(redis.url);
    app = await startApp({ DEMO: 'on' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    redisClient?.disconnect();
    await db?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    await redisClient.flushall();
    await prisma.user.deleteMany();
    photos.photos.clear();
    queued.length = 0;
  });

  async function startDemo() {
    const agent = request.agent(app.getHttpServer());
    const response = await agent.post('/demo').expect(201);
    return { agent, user: response.body as { id: string; email: string; demo: boolean }, cookie: String(response.headers['set-cookie']) };
  }

  const checkPage = async (userId: string) => prisma.page.findFirstOrThrow({ where: { book: { userId }, status: 'AWAITING_CHECK' } });

  it('is off unless DEMO=on', async () => {
    const off = await startApp({});
    try {
      expect((await request(off.getHttpServer()).get('/demo').expect(200)).body).toEqual({ enabled: false });
      await request(off.getHttpServer()).post('/demo').expect(404);
      expect(await prisma.user.count()).toBe(0);
    } finally {
      await off.close();
    }
  });

  it('signs a visitor in to their own account with sample pages, words and due cards', async () => {
    expect((await request(app.getHttpServer()).get('/demo').expect(200)).body).toEqual({ enabled: true });
    const { agent, user, cookie } = await startDemo();
    expect(user.demo).toBe(true);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=86400/);
    expect((await agent.get('/me').expect(200)).body).toEqual(user);

    const [book] = (await agent.get('/books').expect(200)).body;
    const pages = (await agent.get(`/books/${book.id}/pages`).expect(200)).body as { id: string; status: string }[];
    expect(pages.map((page) => page.status).sort()).toEqual(['AWAITING_CHECK', 'DONE', 'DONE']);
    const waiting = pages.find((page) => page.status === 'AWAITING_CHECK')!;
    const marks = (await agent.get(`/pages/${waiting.id}/marks`).expect(200)).body as { type: string }[];
    expect(marks.some((mark) => mark.type === 'unclear')).toBe(true);
    await agent.get(`/pages/${waiting.id}/photo`).expect(200).expect('Content-Type', /image\/jpeg/);
    expect((await agent.get('/review/due').expect(200)).body.length).toBeGreaterThan(0);
    expect((await agent.get('/wordbank').expect(200)).body.length).toBeGreaterThan(0);
  });

  it('keeps two visitors apart', async () => {
    const first = await startDemo();
    const second = await startDemo();
    expect(first.user.id).not.toBe(second.user.id);
    await second.agent.get(`/pages/${(await checkPage(first.user.id)).id}`).expect(404);
  });

  it('refuses uploads, new books and retries, and limits added marks', async () => {
    const { agent, user } = await startDemo();
    const page = await checkPage(user.id);
    const upload = await agent.post(`/books/${page.bookId}/pages`).field('pageNumber', '9').attach('photo', Buffer.from([0xff, 0xd8, 0xff, 1]), 'p.jpg').expect(403);
    expect(upload.body.message).toMatch(/demo/i);
    await agent.post('/books').send({ title: 'Mine' }).expect(403);
    await agent.post(`/pages/${page.id}/retry`).expect(403);
    await prisma.mark.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ pageId: page.id, order: 100 + i, type: 'curly' as const, text: 'x', source: 'added' as const })) });
    await agent.post(`/pages/${page.id}/marks`).send({ type: 'curly', text: '하나 더' }).expect(403);
    expect(queued).toEqual([]);
  });

  it('explains the sample page from saved answers: no Claude call, no cost', async () => {
    const { agent, user } = await startDemo();
    const page = await checkPage(user.id);
    const marks = (await agent.get(`/pages/${page.id}/marks`)).body as { id: string; type: string }[];
    await agent.patch(`/marks/${marks.find((mark) => mark.type === 'unclear')!.id}`).send({ type: 'underline_save' }).expect(200);
    await agent.post(`/pages/${page.id}/marks`).send({ type: 'underline_save', text: '고양이' }).expect(201); // has no saved answer
    await agent.post(`/pages/${page.id}/confirm`).expect(200);
    expect(queued).toEqual([page.id]);

    const real: AiClient = { generate: vi.fn(async () => Promise.reject(new Error('Claude must not be called'))) };
    const processor = new ExplanationProcessor(prisma, photos, new DemoRoutingAiClient(real, prisma));
    await processor.process({ data: { pageId: page.id }, attemptsMade: 0, opts: { attempts: 3 } });

    expect(real.generate).not.toHaveBeenCalled();
    expect(await prisma.aiCall.count()).toBe(0);
    const { body } = await agent.get(`/pages/${page.id}/results`).expect(200);
    const text = JSON.stringify(body);
    expect(text).toContain('suddenly');
    expect(text).toContain('seenBefore'); // the first word was already met on an earlier page
    expect(text).toMatch(/demo has no saved explanation/i);
    const repeated = await prisma.item.findFirstOrThrow({ where: { userId: user.id, normalForm: '은은하다' }, include: { senses: { include: { sightings: true } } } });
    expect(repeated.senses).toHaveLength(1);
    expect(repeated.senses[0].sightings).toHaveLength(2);
  });

  it('sends ordinary readers to the real client, and refuses to read photos for a demo', async () => {
    const reader = await prisma.user.create({ data: { email: 'reader@example.com' } });
    const { user } = await startDemo();
    const real: AiClient = { generate: vi.fn(async () => 'real' as never) };
    const client = new DemoRoutingAiClient(real, prisma);
    const base = { purpose: 'detect' as const, system: '', prompt: '', schema: {} as never };
    expect(await client.generate({ ...base, userId: reader.id })).toBe('real');
    await expect(client.generate({ ...base, userId: user.id })).rejects.toThrow(/demo/i);
    expect(real.generate).toHaveBeenCalledTimes(1);
  });

  it('limits new demos per hour, and starts none when it cannot count', async () => {
    await redisClient.set(`demo:all:${new Date().toISOString().slice(0, 13)}`, DEMOS_PER_HOUR);
    await request(app.getHttpServer()).post('/demo').expect(429);
    const noRedis = await startApp({ DEMO: 'on', REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      await request(noRedis.getHttpServer()).post('/demo').expect(503);
    } finally {
      await noRedis.close();
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it('deletes a demo and its photo after 24 hours, and never an ordinary account', async () => {
    const reader = await prisma.user.create({ data: { email: 'reader@example.com', createdAt: new Date(0) } });
    const { user } = await startDemo();
    expect(photos.photos.size).toBe(1);
    const accounts = app.get(AccountService);
    expect(await deleteExpiredDemos(prisma, accounts, new Date(Date.now() + DEMO_LIFETIME_MS - 60_000))).toBe(0);
    expect(await deleteExpiredDemos(prisma, accounts, new Date(Date.now() + DEMO_LIFETIME_MS + 60_000))).toBe(1);
    expect(await prisma.user.findMany({ select: { id: true } })).toEqual([{ id: reader.id }]);
    expect(photos.photos.size).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });

  it('still confirms a demo page when the monthly budget is reached, because it costs nothing', async () => {
    const { agent, user } = await startDemo();
    const page = await checkPage(user.id);
    await prisma.mark.deleteMany({ where: { pageId: page.id, type: 'unclear' } });
    vi.spyOn(app.get(UsageService), 'isBudgetReached').mockResolvedValueOnce(true);
    await agent.post(`/pages/${page.id}/confirm`).expect(200);
    vi.restoreAllMocks();
  });
});
