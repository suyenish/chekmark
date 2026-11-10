import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import type { PageStatus } from '../src/generated/prisma/client.js';
import { createRedisConnection, EXPIRED_PHOTO_CHECK, MAINTENANCE_QUEUE, PAGE_QUEUE } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { deleteExpiredPhotos, PHOTO_RETENTION_MS } from '../src/photos/photo-retention.js';
import { deleteExpiredSignIns } from '../src/accounts/sign-in-cleanup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkerModule } from '../src/worker.module.js';
import { FakePageQueue } from './helpers/fake-page-queue.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { seedExplainedPage } from './helpers/seed-wordbank.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
const DAY = 24 * 60 * 60 * 1000;

/** A memory store that fails to delete chosen keys, like storage being briefly down. */
class FlakyPhotoStore extends MemoryPhotoStore {
  readonly failing = new Set<string>();
  override async delete(key: string): Promise<void> {
    if (this.failing.has(key)) throw new Error('storage unavailable');
    await super.delete(key);
  }
}

type Agent = ReturnType<typeof request.agent>;

describe('photo retention and account deletion', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new LogMailer();
  const photos = new FlakyPhotoStore();
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

  async function createPage(status: PageStatus, ageDays: number, userId = ownerId, inBook = bookId) {
    const page = await prisma.page.create({
      data: {
        bookId: inBook,
        pageNumber: 1,
        photoKey: `users/${userId}/pages/${crypto.randomUUID()}.jpg`,
        status,
        statusChangedAt: new Date(Date.now() - ageDays * DAY),
      },
    });
    await photos.put(page.photoKey, Buffer.from([0xff, 0xd8, 0xff]));
    return page;
  }

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: 'redis://127.0.0.1:1', ALLOWED_EMAILS: `${OWNER},${OTHER}` }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .overrideProvider(PAGE_QUEUE)
      .useValue(new FakePageQueue())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    photos.failing.clear();
    photos.photos.clear();
    await prisma.user.deleteMany();
    owner = await signIn(OWNER);
    other = await signIn(OTHER);
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER } })).id;
    bookId = (await prisma.book.create({ data: { userId: ownerId, title: '아몬드' } })).id;
  });

  describe('deleteExpiredPhotos', () => {
    it('keeps photos for 30 days', () => {
      expect(PHOTO_RETENTION_MS).toBe(30 * DAY);
    });

    it('deletes photos on pages unchanged for over 30 days, whatever their status', async () => {
      const old = [];
      for (const status of ['UPLOADED', 'AWAITING_CHECK', 'DONE', 'FAILED'] as const) old.push(await createPage(status, 31));
      expect(await deleteExpiredPhotos(prisma, photos, new Date())).toBe(4);
      for (const page of old) {
        expect(photos.photos.has(page.photoKey)).toBe(false);
        expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).photoDeletedAt).not.toBeNull();
      }
    });

    it('keeps newer photos', async () => {
      const recent = await createPage('DONE', 29);
      expect(await deleteExpiredPhotos(prisma, photos, new Date())).toBe(0);
      expect(photos.photos.has(recent.photoKey)).toBe(true);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: recent.id } })).photoDeletedAt).toBeNull();
    });

    it('sets photo_deleted_at and keeps results and word bank entries', async () => {
      const { page } = await seedExplainedPage(prisma, {
        userId: ownerId,
        bookId,
        pageNumber: 4,
        marks: [
          { type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } },
          { type: 'underline_translate', text: '너무나 기뻤다.', result: { translation: 'I was so happy.' } },
        ],
      });
      await prisma.page.update({ where: { id: page.id }, data: { statusChangedAt: new Date(Date.now() - 40 * DAY) } });
      const now = new Date();
      expect(await deleteExpiredPhotos(prisma, photos, now)).toBe(1);

      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).photoDeletedAt).toEqual(now);
      expect(await prisma.mark.count({ where: { pageId: page.id } })).toBe(2);
      expect(await prisma.item.count()).toBe(1);
      expect(await prisma.card.count()).toBe(1);
      expect(await prisma.translation.count()).toBe(1);
      const results = await owner.get(`/pages/${page.id}/results`).expect(200);
      expect(results.body).toHaveLength(2);
      expect((await owner.get(`/pages/${page.id}`).expect(200)).body.hasPhoto).toBe(false);
      await owner.get(`/pages/${page.id}/photo`).expect(404);
      // Already deleted: the next run does not count it again.
      expect(await deleteExpiredPhotos(prisma, photos, new Date())).toBe(0);
    });

    it('retries a storage failure on the next run', async () => {
      const failing = await createPage('DONE', 35);
      const fine = await createPage('DONE', 35);
      photos.failing.add(failing.photoKey);

      expect(await deleteExpiredPhotos(prisma, photos, new Date())).toBe(1);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: failing.id } })).photoDeletedAt).toBeNull();
      expect((await prisma.page.findUniqueOrThrow({ where: { id: fine.id } })).photoDeletedAt).not.toBeNull();

      photos.failing.clear();
      expect(await deleteExpiredPhotos(prisma, photos, new Date())).toBe(1);
      expect(photos.photos.has(failing.photoKey)).toBe(false);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: failing.id } })).photoDeletedAt).not.toBeNull();
    });

    it('runs every day in the worker process', async () => {
      const expired = await createPage('DONE', 31);
      const worker = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url }))
        .overrideProvider(PHOTO_STORE)
        .useValue(photos)
        .compile();
      const context = worker.createNestApplication();
      await context.init();
      const maintenance = new Queue(MAINTENANCE_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
      try {
        const schedulers = await maintenance.getJobSchedulers();
        expect(schedulers.find((s) => s.key === EXPIRED_PHOTO_CHECK)).toMatchObject({ every: DAY });
        await maintenance.add(EXPIRED_PHOTO_CHECK, {});
        await expect.poll(async () => (await prisma.page.findUniqueOrThrow({ where: { id: expired.id } })).photoDeletedAt, { timeout: 10_000 }).not.toBeNull();
        expect(photos.photos.has(expired.photoKey)).toBe(false);
      } finally {
        await maintenance.close();
        await context.close();
      }
    });
  });

  describe('deleteExpiredSignIns', () => {
    it('removes expired sessions and old sign-in links, and keeps live ones', async () => {
      const now = new Date();
      const day = 24 * 60 * 60 * 1000;
      await prisma.session.createMany({
        data: [
          { userId: ownerId, tokenHash: 'expired-session', expiresAt: new Date(now.getTime() - 1000) },
          { userId: ownerId, tokenHash: 'live-session', expiresAt: new Date(now.getTime() + day) },
        ],
      });
      await prisma.loginToken.createMany({
        data: [
          { email: 'a@example.com', tokenHash: 'old-link', expiresAt: new Date(now.getTime() - 2 * day) },
          { email: 'a@example.com', tokenHash: 'just-expired-link', expiresAt: new Date(now.getTime() - 60_000) },
          { email: 'a@example.com', tokenHash: 'live-link', expiresAt: new Date(now.getTime() + 60_000) },
        ],
      });
      const removed = await deleteExpiredSignIns(prisma, now);
      expect(removed).toEqual({ sessions: 1, links: 1 });
      expect(await prisma.session.count({ where: { tokenHash: { in: ['expired-session', 'live-session'] } } })).toBe(1);
      // A link that expired a minute ago stays for a day, so "expired" can still be told from "never existed" in the logs.
      expect((await prisma.loginToken.findMany({ where: { email: 'a@example.com' } })).map((t) => t.tokenHash).sort()).toEqual(['just-expired-link', 'live-link']);
      await owner.get('/me').expect(200); // the owner's own live session is untouched
    });
  });

  describe('DELETE /pages/:id/photo', () => {
    it('deletes one photo on request', async () => {
      const page = await createPage('DONE', 1);
      const kept = await createPage('DONE', 1);
      await owner.delete(`/pages/${page.id}/photo`).expect(204);
      expect(photos.photos.has(page.photoKey)).toBe(false);
      expect(photos.photos.has(kept.photoKey)).toBe(true);
      expect((await owner.get(`/pages/${page.id}`).expect(200)).body.hasPhoto).toBe(false);
      await owner.delete(`/pages/${page.id}/photo`).expect(204); // already gone: still fine
    });

    it('waits until the marks are read before deleting a photo', async () => {
      for (const status of ['UPLOADED', 'DETECTING'] as const) {
        const page = await createPage(status, 0);
        await owner.delete(`/pages/${page.id}/photo`).expect(409);
        expect(photos.photos.has(page.photoKey)).toBe(true);
      }
    });

    it('keeps photo_deleted_at empty when storage fails, so the request can be repeated', async () => {
      const page = await createPage('DONE', 1);
      photos.failing.add(page.photoKey);
      await owner.delete(`/pages/${page.id}/photo`).expect(500);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).photoDeletedAt).toBeNull();
    });

    it("returns 404 for another user's page", async () => {
      const page = await createPage('DONE', 1);
      await other.delete(`/pages/${page.id}/photo`).expect(404);
      expect(photos.photos.has(page.photoKey)).toBe(true);
    });
  });

  describe('DELETE /account', () => {
    it('DELETE /account removes all user rows and photos, and ends the session', async () => {
      await seedExplainedPage(prisma, {
        userId: ownerId,
        bookId,
        pageNumber: 2,
        marks: [{ type: 'underline_save', text: '가까스로', result: { meaning: 'barely' } }],
      });
      const page = await createPage('DONE', 1);
      await prisma.aiCall.create({ data: { userId: ownerId, pageId: page.id, purpose: 'detect', model: 'm', inputTokens: 1, outputTokens: 1, cost: 0.001, durationMs: 1 } });
      const otherId = (await prisma.user.findUniqueOrThrow({ where: { email: OTHER } })).id;
      const otherBook = await prisma.book.create({ data: { userId: otherId, title: 'Theirs' } });
      const theirs = await createPage('DONE', 1, otherId, otherBook.id);

      const response = await owner.delete('/account').expect(204);
      expect(String(response.headers['set-cookie'])).toMatch(/session=;/);

      expect(await prisma.user.count({ where: { id: ownerId } })).toBe(0);
      for (const count of [
        prisma.book.count({ where: { userId: ownerId } }),
        prisma.page.count({ where: { bookId } }),
        prisma.item.count({ where: { userId: ownerId } }),
        prisma.card.count({ where: { sense: { item: { userId: ownerId } } } }),
        prisma.session.count({ where: { userId: ownerId } }),
        prisma.aiCall.count({ where: { userId: ownerId } }),
        prisma.loginToken.count({ where: { email: OWNER } }),
      ]) {
        expect(await count).toBe(0);
      }
      expect([...photos.photos.keys()].filter((key) => key.includes(ownerId))).toEqual([]);
      await owner.get('/me').expect(401);

      // The money was still spent: the cost record stays, no longer tied to anyone, and still counts towards the budget.
      const calls = await prisma.aiCall.findMany();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ userId: null, pageId: null, purpose: 'detect' });

      // The other reader is untouched.
      expect(photos.photos.has(theirs.photoKey)).toBe(true);
      await other.get('/me').expect(200);
    });

    it('deletes nothing when a photo cannot be deleted, so it can be tried again', async () => {
      const page = await createPage('DONE', 1);
      photos.failing.add(page.photoKey);
      await owner.delete('/account').expect(500);
      expect(await prisma.user.count({ where: { id: ownerId } })).toBe(1);
      await owner.get('/me').expect(200);
    });

    it('requires sign-in', async () => {
      await request(app.getHttpServer()).delete('/account').expect(401);
    });
  });
});
