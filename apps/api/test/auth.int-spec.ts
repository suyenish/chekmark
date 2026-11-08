import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { startTestDb } from './helpers/test-db.js';

const ALLOWED = 'reader@example.com';
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
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, ALLOWED_EMAILS: `${ALLOWED}, second@example.com` }))
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

describe('sign-in in production', () => {
  it('marks the session cookie Secure', async () => {
    const db = await startTestDb();
    const mailer = new LogMailer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'production', DATABASE_URL: db.url, ALLOWED_EMAILS: ALLOWED, SMTP_URL: 'smtp://localhost:2525' }))
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
