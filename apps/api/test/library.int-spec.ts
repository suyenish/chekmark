import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LogMailer, MAILER } from '../src/accounts/mailer.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

/** The smallest bytes that start like a JPEG file. Content does not matter to the API. */
const jpeg = (size = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(0, size - 4), 7)]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]);

describe('books, pages and photos', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: INestApplication;
  let prisma: PrismaService;
  const mailer = new LogMailer();
  const photos = new MemoryPhotoStore();
  let owner: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;

  async function signIn(email: string) {
    await request(app.getHttpServer()).post('/auth/request-link').send({ email }).expect(202);
    const token = new URL(mailer.sent.at(-1)!.url).searchParams.get('token')!;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/verify').send({ token }).expect(200);
    return agent;
  }

  async function createBook(agent = owner, title = 'Almond') {
    const response = await agent.post('/books').send({ title }).expect(201);
    return response.body as { id: string; title: string; sourceLanguage: string };
  }

  const upload = (agent: ReturnType<typeof request.agent>, bookId: string, file: Buffer, pageNumber: string | null = '12', filename = 'page.jpg') => {
    const req = agent.post(`/books/${bookId}/pages`).attach('photo', file, { filename, contentType: 'image/jpeg' });
    return pageNumber === null ? req : req.field('pageNumber', pageNumber);
  };

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, ALLOWED_EMAILS: `${OWNER},${OTHER}` }))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    prisma = app.get(PrismaService);
    owner = await signIn(OWNER);
    other = await signIn(OTHER);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('requires sign-in', async () => {
    await request(app.getHttpServer()).get('/books').expect(401);
    await request(app.getHttpServer()).post('/books').send({ title: 'x' }).expect(401);
  });

  it('creates a book with source_language ko', async () => {
    const book = await createBook(owner, '  아몬드  ');
    expect(book).toMatchObject({ id: expect.any(String), title: '아몬드', sourceLanguage: 'ko' });
    const list = await owner.get('/books').expect(200);
    expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: book.id, title: '아몬드', pageCount: 0 })]));
  });

  it('returns 400 for a missing or empty title', async () => {
    await owner.post('/books').send({}).expect(400);
    await owner.post('/books').send({ title: '   ' }).expect(400);
  });

  it('renames a book', async () => {
    const book = await createBook();
    const renamed = await owner.patch(`/books/${book.id}`).send({ title: 'Almond (2nd)' }).expect(200);
    expect(renamed.body.title).toBe('Almond (2nd)');
    expect((await owner.get(`/books/${book.id}`).expect(200)).body.title).toBe('Almond (2nd)');
  });

  it('stores an uploaded JPEG and creates a page with status UPLOADED', async () => {
    const book = await createBook();
    const file = jpeg(2048);
    const response = await upload(owner, book.id, file).expect(201);
    expect(response.body).toMatchObject({ id: expect.any(String), bookId: book.id, pageNumber: 12, status: 'UPLOADED' });
    expect(response.body).not.toHaveProperty('photoKey');

    const row = await prisma.page.findUniqueOrThrow({ where: { id: response.body.id }, include: { book: true } });
    expect(row.photoKey).toBe(`users/${row.book.userId}/pages/${row.id}.jpg`);
    expect(photos.photos.get(row.photoKey)).toEqual(file);

    const photo = await owner.get(`/pages/${row.id}/photo`).expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(photo.body as Buffer, file)).toBe(0);

    const page = await owner.get(`/pages/${row.id}`).expect(200);
    expect(page.body).toMatchObject({ id: row.id, status: 'UPLOADED', pageNumber: 12 });
    const pages = await owner.get(`/books/${book.id}/pages`).expect(200);
    expect(pages.body.map((p: { id: string }) => p.id)).toEqual([row.id]);
  });

  it('returns 415 with a clear message for a PNG, HEIC or text file, checking file bytes', async () => {
    const book = await createBook();
    for (const file of [png, heic, Buffer.from('just some text')]) {
      // The client claims image/jpeg every time: only the bytes decide.
      const response = await upload(owner, book.id, file).expect(415);
      expect(response.body.message).toMatch(/JPEG/);
    }
    expect(await prisma.page.count({ where: { bookId: book.id } })).toBe(0);
  });

  it('returns 400 when the photo is missing', async () => {
    const book = await createBook();
    await owner.post(`/books/${book.id}/pages`).field('pageNumber', '3').expect(400);
  });

  it('returns 413 above 10 MB', async () => {
    const book = await createBook();
    await upload(owner, book.id, jpeg(10 * 1024 * 1024 + 1)).expect(413);
    await upload(owner, book.id, jpeg(10 * 1024 * 1024)).expect(201);
  });

  it('returns 400 when the page number is missing or below 1', async () => {
    const book = await createBook();
    for (const pageNumber of [null, '', '0', '-3', '1.5', 'twelve']) {
      await upload(owner, book.id, jpeg(), pageNumber).expect(400);
    }
    expect(await prisma.page.count({ where: { bookId: book.id } })).toBe(0);
    expect([...photos.photos.keys()].filter((key) => key.includes('undefined'))).toEqual([]);
  });

  it("returns 404 for another user's book, page and photo", async () => {
    const book = await createBook(owner);
    const page = (await upload(owner, book.id, jpeg()).expect(201)).body as { id: string };

    await other.get(`/books/${book.id}`).expect(404);
    await other.patch(`/books/${book.id}`).send({ title: 'mine now' }).expect(404);
    await other.delete(`/books/${book.id}`).expect(404);
    await other.get(`/books/${book.id}/pages`).expect(404);
    await upload(other, book.id, jpeg()).expect(404);
    await other.get(`/pages/${page.id}`).expect(404);
    await other.get(`/pages/${page.id}/photo`).expect(404);
    expect((await other.get('/books').expect(200)).body.map((b: { id: string }) => b.id)).not.toContain(book.id);

    // Still there for the owner.
    await owner.get(`/pages/${page.id}/photo`).expect(200);
  });

  it('returns 404 for an ID that does not exist or is not an ID', async () => {
    await owner.get('/books/00000000-0000-4000-8000-000000000000').expect(404);
    await owner.get('/books/not-an-id').expect(404);
    await owner.get('/pages/not-an-id/photo').expect(404);
  });

  it('allows two photos of the same page number', async () => {
    const book = await createBook();
    const first = (await upload(owner, book.id, jpeg(), '7').expect(201)).body;
    const second = (await upload(owner, book.id, jpeg(), '7').expect(201)).body;
    expect(first.id).not.toBe(second.id);
    const pages = await owner.get(`/books/${book.id}/pages`).expect(200);
    expect(pages.body).toHaveLength(2);
    expect((await owner.get('/books').expect(200)).body.find((b: { id: string }) => b.id === book.id).pageCount).toBe(2);
  });

  it('deletes a book with its pages and photos', async () => {
    const book = await createBook();
    const page = (await upload(owner, book.id, jpeg()).expect(201)).body as { id: string };
    const { photoKey } = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });

    await owner.delete(`/books/${book.id}`).expect(204);
    await owner.get(`/books/${book.id}`).expect(404);
    await owner.get(`/pages/${page.id}`).expect(404);
    expect(photos.photos.has(photoKey)).toBe(false);
  });
});
