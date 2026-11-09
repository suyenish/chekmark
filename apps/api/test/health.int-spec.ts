import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { BullMqPageQueue, PAGE_QUEUE } from '../src/jobs/queues.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

describe('GET /health', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
  });

  afterAll(async () => {
    await db?.stop();
    await redis?.stop();
  });

  async function startApp(redisUrl: string) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redisUrl }))
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);
    return app;
  }

  it('reports PostgreSQL and Redis as up, without signing in', async () => {
    const app = await startApp(redis.url);
    try {
      await app.get<BullMqPageQueue>(PAGE_QUEUE).waitUntilReady();
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok', postgres: 'up', redis: 'up' });
    } finally {
      await app.close();
    }
  });

  it('answers 503 quickly and names Redis when Redis is down', async () => {
    const app = await startApp('redis://127.0.0.1:1');
    try {
      const started = Date.now();
      const response = await request(app.getHttpServer()).get('/health').expect(503);
      expect(response.body).toEqual({ status: 'degraded', postgres: 'up', redis: 'down' });
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await app.close();
    }
  });
});
