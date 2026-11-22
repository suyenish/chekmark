import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { LogMailer, MAILER, type Mailer } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { BullMqPageQueue, PAGE_QUEUE } from '../src/jobs/queues.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

const ALLOWED = 'reader@example.com';
/** Nothing listens here, so these tests never touch a developer's local Redis. */
const NO_REDIS = 'redis://127.0.0.1:1';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('sign-in with one-time links', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new LogMailer();

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, ALLOWED_EMAILS: `${ALLOWED}, second@example.com`, REDIS_URL: NO_REDIS }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // a real port, so supertest does not start and stop the server per request
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  beforeEach(() => {
    mailer.sent.length = 0;
  });

  /** Requests a link and returns the token from the emailed URL. */
  async function requestToken(email = ALLOWED): Promise<string> {
    await request(app.getHttpServer()).post('/auth/request-link').send({ email }).expect(202);
    const url = new URL(mailer.sent.at(-1)!.url);
    return url.searchParams.get('token')!;
  }

  const sessionCookie = (response: request.Response) =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('session='));

  it('sends a link to an allowed email and creates the user on first verify', async () => {
    const token = await requestToken(' Reader@Example.com ');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].email).toBe(ALLOWED);
    expect(mailer.sent[0].url).toMatch(/^http:\/\/localhost:5173\/sign-in\?token=/);
    expect(await prisma.user.count({ where: { email: ALLOWED } })).toBe(0);

    const agent = request.agent(app.getHttpServer());
    const verified = await agent.post('/auth/verify').send({ token }).expect(200);
    expect(verified.body).toEqual({ id: expect.any(String), email: ALLOWED });
    expect(await prisma.user.count({ where: { email: ALLOWED } })).toBe(1);

    const me = await agent.get('/me').expect(200);
    expect(me.body).toEqual({ id: verified.body.id, email: ALLOWED });
  });

  it('signs an existing user in again without creating a second user', async () => {
    await request(app.getHttpServer()).post('/auth/verify').send({ token: await requestToken() }).expect(200);
    await request(app.getHttpServer()).post('/auth/verify').send({ token: await requestToken() }).expect(200);
    expect(await prisma.user.count({ where: { email: ALLOWED } })).toBe(1);
  });

  it('returns 202 and sends nothing for an email outside ALLOWED_EMAILS', async () => {
    await request(app.getHttpServer()).post('/auth/request-link').send({ email: 'stranger@example.com' }).expect(202);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.loginToken.count({ where: { email: 'stranger@example.com' } })).toBe(0);
  });

  it('returns 400 for something that is not an email', async () => {
    await request(app.getHttpServer()).post('/auth/request-link').send({ email: 'not an email' }).expect(400);
    await request(app.getHttpServer()).post('/auth/request-link').send({}).expect(400);
  });

  it('makes a link that lasts 15 minutes', async () => {
    const token = await requestToken();
    const row = await prisma.loginToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(15 * 60 * 1000);
  });

  it('rejects a token after 15 minutes', async () => {
    const token = await requestToken();
    await prisma.loginToken.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(401);
  });

  it('rejects a token used a second time', async () => {
    const token = await requestToken();
    await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(200);
    await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(401);
  });

  it('lets only one of two simultaneous uses of a token succeed', async () => {
    const token = await requestToken();
    const verify = () => request(app.getHttpServer()).post('/auth/verify').send({ token });
    const statuses = (await Promise.all([verify(), verify()])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('rejects a made-up or missing token', async () => {
    await request(app.getHttpServer()).post('/auth/verify').send({ token: 'made-up' }).expect(401);
    await request(app.getHttpServer()).post('/auth/verify').send({}).expect(400);
  });

  it('stores only a hash of the token and the session ID', async () => {
    const token = await requestToken();
    expect(await prisma.loginToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.loginToken.count({ where: { tokenHash: sha256(token) } })).toBe(1);

    const response = await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(200);
    const sessionId = /^session=([^;]+)/.exec(sessionCookie(response)!)![1];
    expect(await prisma.session.count({ where: { tokenHash: sessionId } })).toBe(0);
    expect(await prisma.session.count({ where: { tokenHash: sha256(sessionId) } })).toBe(1);
  });

  it('sets a 30-day httpOnly, sameSite=lax session cookie', async () => {
    const response = await request(app.getHttpServer()).post('/auth/verify').send({ token: await requestToken() }).expect(200);
    const cookie = sessionCookie(response)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/i); // only in production
  });

  it('refuses a request that changes something when it comes from another website', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/verify').send({ token: await requestToken() }).expect(200);

    const forged = await agent.post('/auth/logout').set('Origin', 'https://evil.example').expect(403);
    expect(forged.body.message).toMatch(/another site/i);
    await agent.get('/me').expect(200); // still signed in: the forged logout did nothing

    await agent.get('/me').set('Origin', 'https://evil.example').expect(200); // reading is not blocked here; the cookie rules cover it
    await agent.post('/auth/logout').set('Origin', 'http://localhost:5173').expect(204); // the app's own address
  });

  it('returns 401 from GET /me without a session or with a made-up one', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
    await request(app.getHttpServer()).get('/me').set('Cookie', 'session=made-up').expect(401);
  });

  it('returns 401 from GET /me when the session has expired', async () => {
    const agent = request.agent(app.getHttpServer());
    const response = await agent.post('/auth/verify').send({ token: await requestToken() }).expect(200);
    const sessionId = /^session=([^;]+)/.exec(sessionCookie(response)!)![1];
    await prisma.session.update({ where: { tokenHash: sha256(sessionId) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await agent.get('/me').expect(401);
  });

  it('returns 401 from GET /me after logout', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/verify').send({ token: await requestToken() }).expect(200);
    await agent.get('/me').expect(200);

    const loggedOut = await agent.post('/auth/logout').expect(204);
    expect(sessionCookie(loggedOut)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    await agent.get('/me').expect(401);
  });

  it('logs out only the current device', async () => {
    const phone = request.agent(app.getHttpServer());
    const laptop = request.agent(app.getHttpServer());
    await phone.post('/auth/verify').send({ token: await requestToken('second@example.com') }).expect(200);
    await laptop.post('/auth/verify').send({ token: await requestToken('second@example.com') }).expect(200);

    await phone.post('/auth/logout').expect(204);
    await phone.get('/me').expect(401);
    await laptop.get('/me').expect(200);
  });
});

describe('sign-in link delivery', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
  });

  afterAll(async () => {
    await db?.stop();
    await redis?.stop();
  });

  // Link counts live in Redis; every test starts from zero.
  beforeEach(async () => {
    const client = new Redis(redis.url);
    await client.flushall();
    client.disconnect();
  });

  async function startApp(env: Record<string, string>, mailer: Mailer = new LogMailer()) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ DATABASE_URL: db.url, REDIS_URL: redis.url, ...env }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    await app.get<BullMqPageQueue>(PAGE_QUEUE).waitUntilReady();
    return app;
  }

  const requestLink = (app: INestApplication, email: string) => request(app.getHttpServer()).post('/auth/request-link').send({ email });

  it('in development without an email service, returns the link so the web app can show it', async () => {
    const app = await startApp({ NODE_ENV: 'development', ALLOWED_EMAILS: ALLOWED });
    try {
      const response = await requestLink(app, ALLOWED).expect(202);
      expect(response.body.dev.link).toMatch(/^http:\/\/localhost:5173\/sign-in\?token=/);
      const token = new URL(response.body.dev.link).searchParams.get('token')!;
      await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(200);
    } finally {
      await app.close();
    }
  });

  it('in development, says when the address is not on the allowed list', async () => {
    const app = await startApp({ NODE_ENV: 'development', ALLOWED_EMAILS: ALLOWED });
    try {
      const response = await requestLink(app, 'stranger@example.com').expect(202);
      expect(response.body).toEqual({ dev: { notAllowed: true } });
    } finally {
      await app.close();
    }
  });

  it('never returns the link, or who is allowed, once an email service is set or in production', async () => {
    const withSmtp = await startApp({ NODE_ENV: 'development', ALLOWED_EMAILS: ALLOWED, SMTP_URL: 'smtp://localhost:2525' });
    const production = await startApp({ NODE_ENV: 'production', ALLOWED_EMAILS: ALLOWED, SMTP_URL: 'smtp://localhost:2525', ANTHROPIC_API_KEY: 'test-key', AI_MODEL: 'claude-haiku-5-5' });
    try {
      for (const app of [withSmtp, production]) {
        expect((await requestLink(app, ALLOWED).expect(202)).body).toEqual({});
        expect((await requestLink(app, 'stranger@example.com').expect(202)).body).toEqual({});
      }
    } finally {
      await withSmtp.close();
      await production.close();
    }
  });

  it('with SIGN_UP=open, sends a link to any address', async () => {
    const mailer = new LogMailer();
    const app = await startApp({ NODE_ENV: 'test', SIGN_UP: 'open' }, mailer);
    try {
      await requestLink(app, 'anyone@example.org').expect(202);
      expect(mailer.sent.map((m) => m.email)).toEqual(['anyone@example.org']);
    } finally {
      await app.close();
    }
  });

  it('stops after 5 links to one address in 15 minutes, whoever asks and whether or not it is allowed', async () => {
    const mailer = new LogMailer();
    const app = await startApp({ NODE_ENV: 'test', ALLOWED_EMAILS: ALLOWED }, mailer);
    try {
      for (let i = 0; i < 5; i++) await requestLink(app, ALLOWED).expect(202);
      const refused = await requestLink(app, ` ${ALLOWED.toUpperCase()} `).expect(429);
      expect(refused.body.message).toMatch(/too many sign-in links/i);
      expect(mailer.sent).toHaveLength(5);
      // The same answer for an address that is not allowed, so the limit reveals nothing.
      for (let i = 0; i < 5; i++) await requestLink(app, 'stranger@example.com').expect(202);
      await requestLink(app, 'stranger@example.com').expect(429);
      // Another address is not affected.
      await requestLink(app, 'second@example.com').expect(202);
    } finally {
      await app.close();
    }
  });

  it('says so when the email could not be sent, instead of pretending it was', async () => {
    const broken: Mailer = {
      sendSignInLink: async () => {
        throw new Error('535 Authentication failed');
      },
      sendAlert: async () => {},
    };
    const app = await startApp({ NODE_ENV: 'test', ALLOWED_EMAILS: ALLOWED }, broken);
    try {
      const response = await requestLink(app, ALLOWED).expect(503);
      expect(response.body.message).toMatch(/could not send the sign-in email/i);
      expect(response.body.message).not.toMatch(/535|Authentication/); // no server details
    } finally {
      await app.close();
    }
  });

  it('still sends links when Redis cannot count them', async () => {
    const mailer = new LogMailer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: NO_REDIS, ALLOWED_EMAILS: ALLOWED }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    try {
      await requestLink(app, ALLOWED).expect(202);
      expect(mailer.sent).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('sign-in in production', () => {
  it('marks the session cookie Secure', async () => {
    const db = await startTestDb();
    const mailer = new LogMailer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'production', DATABASE_URL: db.url, ALLOWED_EMAILS: ALLOWED, SMTP_URL: 'smtp://localhost:2525', ANTHROPIC_API_KEY: 'test-key', AI_MODEL: 'claude-haiku-5-5', REDIS_URL: NO_REDIS }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    try {
      await request(app.getHttpServer()).post('/auth/request-link').send({ email: ALLOWED }).expect(202);
      const token = new URL(mailer.sent[0].url).searchParams.get('token')!;
      const response = await request(app.getHttpServer()).post('/auth/verify').send({ token }).expect(200);
      expect(String(response.headers['set-cookie'])).toMatch(/;\s*Secure/i);
    } finally {
      await app.close();
      await db.stop();
    }
  });
});
