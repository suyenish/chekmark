import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { AI_CLIENT, AiTransientError } from '../src/ai/ai-client.js';
import { AiCallLogger } from '../src/ai/ai-call-logger.js';
import { FakeAiClient } from '../src/ai/fake-ai-client.js';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { ExplanationProcessor } from '../src/explanation/explanation.processor.js';
import type { MarkSource, MarkType } from '../src/generated/prisma/client.js';
import { createRedisConnection, EXPLANATION_QUEUE, PAGE_JOB_OPTIONS } from '../src/jobs/queues.js';
import { PHOTO_STORE } from '../src/photos/photo-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { type ExplainResult, saveResults } from '../src/wordbank/save-results.js';
import { WorkerModule } from '../src/worker.module.js';
import { MemoryPhotoStore } from './helpers/memory-photo-store.js';
import { startTestDb } from './helpers/test-db.js';
import { startTestRedis } from './helpers/test-redis.js';

type MarkSeed = { type: MarkType; text: string; normalForm?: string | null; sentence?: string | null; source?: MarkSource };

/** One explain result as the model returns it (snake_case, every field present). */
type Raw = {
  mark_id: string;
  kind: 'translation' | 'existing' | 'new';
  translation: string | null;
  sense_id: string | null;
  meaning: string | null;
  notes: string | null;
  example: string | null;
  example_translation: string | null;
  sentence_translation: string | null;
};
const blank = { translation: null, sense_id: null, meaning: null, notes: null, example: null, example_translation: null, sentence_translation: null };
const translation = (markId: string, text: string): Raw => ({ ...blank, mark_id: markId, kind: 'translation', translation: text });
const existing = (markId: string, senseId: string): Raw => ({
  ...blank,
  mark_id: markId,
  kind: 'existing',
  sense_id: senseId,
  sentence_translation: 'Sentence in English.',
});
const fresh = (markId: string, meaning: string): Raw => ({
  ...blank,
  mark_id: markId,
  kind: 'new',
  meaning,
  notes: 'A short note.',
  example: '예문이에요.',
  example_translation: 'It is an example.',
  sentence_translation: 'Sentence in English.',
});
const explained = (...results: Raw[]) => ({ output: { results } });

const job = (pageId: string, attemptsMade = 0) => ({ data: { pageId }, attemptsMade, opts: { attempts: 3 } });

describe('explanations and the word bank', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let redis: Awaited<ReturnType<typeof startTestRedis>>;
  let redisClient: Redis;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let processor: ExplanationProcessor;
  let fake: FakeAiClient;
  const photos = new MemoryPhotoStore();
  let userId: string;
  let bookId: string;

  beforeAll(async () => {
    [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
    redisClient = new Redis(redis.url);
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: 'test', DATABASE_URL: db.url, REDIS_URL: redis.url }))
      .overrideProvider(PHOTO_STORE)
      .useValue(photos)
      .overrideProvider(AI_CLIENT)
      .useFactory({
        inject: [AiCallLogger],
        factory: (logger: AiCallLogger) => {
          fake = new FakeAiClient({ nodeEnv: 'test', onUsage: (u) => logger.log(u) });
          return fake;
        },
      })
      .compile();
    prisma = moduleRef.get(PrismaService);
    processor = moduleRef.get(ExplanationProcessor);
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
    await prisma.item.deleteMany(); // senses, sightings and cards go with their items
    await prisma.page.deleteMany();
  });

  /** A confirmed page waiting for explanations, with marks in the given order. */
  async function createPage(marks: MarkSeed[], pageNumber = 12) {
    const page = await prisma.page.create({
      data: { bookId, pageNumber, photoKey: `users/${userId}/pages/${crypto.randomUUID()}.jpg`, status: 'EXPLAINING' },
    });
    await photos.put(page.photoKey, Buffer.from([0xff, 0xd8, 0xff, 1]));
    await prisma.mark.createMany({
      data: marks.map((mark, order) => ({
        pageId: page.id,
        order,
        type: mark.type,
        text: mark.text,
        normalForm: mark.normalForm === undefined ? (mark.type === 'underline_translate' ? null : mark.text) : mark.normalForm,
        sentence: mark.sentence === undefined ? `${mark.text} 문장.` : mark.sentence,
        source: mark.source ?? 'detected',
      })),
    });
    const rows = await prisma.mark.findMany({ where: { pageId: page.id }, orderBy: { order: 'asc' } });
    return { page, marks: rows };
  }

  const counts = async () => ({
    items: await prisma.item.count(),
    senses: await prisma.sense.count(),
    sightings: await prisma.sighting.count(),
    cards: await prisma.card.count(),
    translations: await prisma.translation.count(),
  });
  const pageStatus = async (id: string) => (await prisma.page.findUniqueOrThrow({ where: { id } })).status;

  it('creates an item, sense, sighting and card for a new underline_save mark', async () => {
    const { page, marks } = await createPage([{ type: 'underline_save', text: '겁먹고', normalForm: '겁먹다', sentence: '그는 겁먹고 도망쳤다.' }]);
    fake.queue(explained(fresh(marks[0].id, 'to get scared')));
    await processor.process(job(page.id));

    const item = await prisma.item.findFirstOrThrow({ include: { senses: { include: { sightings: true, card: true } } } });
    expect(item).toMatchObject({ userId, kind: 'word', language: 'ko', normalForm: '겁먹다' });
    const sense = item.senses[0];
    expect(sense).toMatchObject({ meaning: 'to get scared', notes: 'A short note.', example: '예문이에요.', exampleTranslation: 'It is an example.' });
    expect(sense.sightings).toEqual([
      expect.objectContaining({ pageId: page.id, markId: marks[0].id, sentence: '그는 겁먹고 도망쳤다.', sentenceTranslation: 'Sentence in English.' }),
    ]);
    expect(sense.card).toMatchObject({ sightingId: sense.sightings[0].id });
    expect(sense.card!.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await pageStatus(page.id)).toBe('DONE');
  });

  it('creates a grammar item for a curly mark', async () => {
    const { page, marks } = await createPage([{ type: 'curly', text: '섰을 뿐', normalForm: '-(으)ㄹ 뿐' }]);
    fake.queue(explained(fresh(marks[0].id, 'only; nothing more than')));
    await processor.process(job(page.id));
    expect(await prisma.item.findFirstOrThrow()).toMatchObject({ kind: 'grammar', normalForm: '-(으)ㄹ 뿐' });
  });

  it('creates a translation and no item or card for an underline_translate mark', async () => {
    const { page, marks } = await createPage([{ type: 'underline_translate', text: '너무나 기뻤다.' }]);
    fake.queue(explained(translation(marks[0].id, 'I was so happy.')));
    await processor.process(job(page.id));
    expect(await prisma.translation.findMany()).toEqual([
      expect.objectContaining({ pageId: page.id, markId: marks[0].id, translatedText: 'I was so happy.' }),
    ]);
    expect(await counts()).toMatchObject({ items: 0, cards: 0, sightings: 0 });
  });

  describe('memory across pages', () => {
    async function existingWord() {
      const first = await createPage([{ type: 'underline_save', text: '끄트머리에', normalForm: '끄트머리' }], 3);
      fake.queue(explained(fresh(first.marks[0].id, 'the very end')));
      await processor.process(job(first.page.id));
      fake.clear();
      return prisma.sense.findFirstOrThrow();
    }

    it('sends existing senses for that normal form to the model', async () => {
      const sense = await existingWord();
      const { page, marks } = await createPage([
        { type: 'underline_save', text: '끄트머리', normalForm: '끄트머리' },
        { type: 'underline_save', text: '겁먹고', normalForm: '겁먹다' },
      ]);
      fake.queue(explained(existing(marks[0].id, sense.id), fresh(marks[1].id, 'to get scared')));
      await processor.process(job(page.id));

      const prompt = fake.requests[0].prompt;
      expect(fake.requests[0].purpose).toBe('explain');
      expect(prompt).toContain(sense.id);
      expect(prompt).toContain('the very end');
      expect(prompt).not.toContain('to get scared');
    });

    it('adds a sighting and no card when the model says the meaning is the same', async () => {
      const sense = await existingWord();
      const { page, marks } = await createPage([{ type: 'underline_save', text: '끄트머리', normalForm: '끄트머리' }]);
      fake.queue(explained(existing(marks[0].id, sense.id)));
      await processor.process(job(page.id));
      expect(await counts()).toMatchObject({ items: 1, senses: 1, sightings: 2, cards: 1 });
      expect(await prisma.sighting.findUniqueOrThrow({ where: { markId: marks[0].id } })).toMatchObject({ senseId: sense.id });
    });

    it('adds a new sense and card to the item when the meaning differs', async () => {
      await existingWord();
      const { page, marks } = await createPage([{ type: 'underline_save', text: '끄트머리', normalForm: '끄트머리' }]);
      fake.queue(explained(fresh(marks[0].id, 'a loose end of thread')));
      await processor.process(job(page.id));
      expect(await counts()).toMatchObject({ items: 1, senses: 2, sightings: 2, cards: 2 });
    });

    it('matches a decomposed or spaced normal form to the existing item', async () => {
      const sense = await existingWord();
      const { page, marks } = await createPage([{ type: 'underline_save', text: '끄트머리', normalForm: ` ${'끄트머리'.normalize('NFD')} ` }]);
      fake.queue(explained(existing(marks[0].id, sense.id)));
      await processor.process(job(page.id));
      expect(fake.requests[0].prompt).toContain(sense.id);
      expect(await counts()).toMatchObject({ items: 1, senses: 1, sightings: 2 });
    });
  });

  it('creates one item, sense and card when a word is marked twice on a page', async () => {
    const { page, marks } = await createPage([
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
      { type: 'curly', text: '비록', normalForm: '비록' },
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
    ]);
    fake.queue(explained(fresh(marks[0].id, 'barely'), fresh(marks[1].id, 'even though'), fresh(marks[2].id, 'barely')));
    await processor.process(job(page.id));
    const item = await prisma.item.findFirstOrThrow({ where: { normalForm: '가까스로' }, include: { senses: { include: { sightings: true, card: true } } } });
    expect(item.senses).toHaveLength(1);
    expect(item.senses[0].sightings).toHaveLength(2);
    // The word's first sighting on the page is the one its card shows.
    const firstSighting = item.senses[0].sightings.find((s) => s.markId === marks[0].id)!;
    expect(item.senses[0].card).toMatchObject({ sightingId: firstSighting.id });
    expect(await counts()).toMatchObject({ items: 2, senses: 2, sightings: 3, cards: 2 });
  });

  it('handles a curly or added word mark inside an underlined sentence as two separate results', async () => {
    const sentence = '비록 긴 줄의 끄트머리에 섰을 뿐이지만, 어쨌거나 표를 구했고 너무나 기뻤다.';
    const { page, marks } = await createPage([
      { type: 'underline_translate', text: sentence, sentence },
      { type: 'curly', text: '비록', normalForm: '비록', sentence },
      { type: 'underline_save', text: '끄트머리', normalForm: '끄트머리', sentence, source: 'added' },
    ]);
    fake.queue(explained(translation(marks[0].id, 'Although I was only a freshman...'), fresh(marks[1].id, 'even though'), fresh(marks[2].id, 'the very end')));
    await processor.process(job(page.id));
    expect(await counts()).toMatchObject({ translations: 1, items: 2, sightings: 2, cards: 2 });
  });

  it('resolves normal_form and sentence from the photo for added and retyped marks', async () => {
    const { page, marks } = await createPage([
      { type: 'underline_save', text: '겁먹고', normalForm: null, sentence: null, source: 'added' },
      { type: 'curly', text: '섰을 뿐', normalForm: null, source: 'corrected' },
      { type: 'underline_save', text: '나락', normalForm: null, sentence: null, source: 'added' },
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
    ]);
    fake.queue(
      {
        output: {
          marks: [
            { mark_id: marks[0].id, normal_form: '겁먹다', sentence: '그는 겁먹고 도망쳤다.' },
            { mark_id: marks[1].id, normal_form: '-(으)ㄹ 뿐', sentence: '줄을 섰을 뿐이다.' },
            { mark_id: marks[2].id, normal_form: '나락', sentence: null }, // sentence not found on the photo
          ],
        },
      },
      explained(fresh(marks[0].id, 'to get scared'), fresh(marks[1].id, 'only'), fresh(marks[2].id, 'abyss'), fresh(marks[3].id, 'barely')),
    );
    await processor.process(job(page.id));

    expect(fake.requests.map((r) => r.purpose)).toEqual(['resolve', 'explain']);
    expect(fake.requests[0].imageJpeg).toEqual(Buffer.from([0xff, 0xd8, 0xff, 1]));
    expect(fake.requests[0].prompt).not.toContain(marks[3].id); // only marks that need it
    const rows = await prisma.mark.findMany({ where: { pageId: page.id }, orderBy: { order: 'asc' } });
    expect(rows.map((m) => [m.normalForm, m.sentence])).toEqual([
      ['겁먹다', '그는 겁먹고 도망쳤다.'],
      ['-(으)ㄹ 뿐', '섰을 뿐 문장.'], // a sentence the mark already had is kept; only what is missing is filled
      ['나락', '나락'], // the marked text stands in for a sentence that cannot be found
      ['가까스로', '가까스로 문장.'],
    ]);
    expect(await prisma.item.findMany({ orderBy: { normalForm: 'asc' } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ normalForm: '겁먹다', kind: 'word' }), expect.objectContaining({ normalForm: '-(으)ㄹ 뿐', kind: 'grammar' })]),
    );
  });

  it('makes no resolve call when every mark already has a dictionary form and sentence', async () => {
    const { page, marks } = await createPage([{ type: 'underline_save', text: '가까스로', normalForm: '가까스로' }]);
    fake.queue(explained(fresh(marks[0].id, 'barely')));
    await processor.process(job(page.id));
    expect(fake.requests.map((r) => r.purpose)).toEqual(['explain']);
  });

  it('treats a result with a missing mark ID or an unknown sense ID as invalid output', async () => {
    const { page, marks } = await createPage([
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
      { type: 'curly', text: '비록', normalForm: '비록' },
    ]);
    fake.queue(explained(fresh(marks[0].id, 'barely'))); // the second mark is missing
    await expect(processor.process(job(page.id))).rejects.toThrow(/mark/i);

    fake.queue(explained(fresh(marks[0].id, 'barely'), existing(marks[1].id, crypto.randomUUID())));
    await expect(processor.process(job(page.id))).rejects.toThrow(/sense/i);

    fake.queue(explained(fresh(marks[0].id, 'barely'), translation(marks[1].id, 'even though'))); // a grammar mark cannot be a translation
    await expect(processor.process(job(page.id))).rejects.toThrow();

    expect(await pageStatus(page.id)).toBe('EXPLAINING');
    expect(await counts()).toMatchObject({ items: 0, senses: 0, sightings: 0, cards: 0 });
  });

  it('creates no duplicates when the job runs twice', async () => {
    const { page, marks } = await createPage([
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
      { type: 'underline_translate', text: '너무나 기뻤다.' },
    ]);
    fake.queue(explained(fresh(marks[0].id, 'barely'), translation(marks[1].id, 'I was so happy.')));
    await processor.process(job(page.id));
    const after = await counts();
    await processor.process(job(page.id)); // already DONE: nothing to do, no AI call
    expect(await counts()).toEqual(after);
    expect(fake.requests).toHaveLength(1);
  });

  it('saves nothing twice even if saveResults is called again for the same marks', async () => {
    const { page, marks } = await createPage([{ type: 'underline_save', text: '가까스로', normalForm: '가까스로' }]);
    const results: ExplainResult[] = [
      { markId: marks[0].id, kind: 'new', meaning: 'barely', notes: 'n', example: 'e', exampleTranslation: 'et', sentenceTranslation: 'st' },
    ];
    await prisma.$transaction((tx) => saveResults(tx, userId, page.id, results));
    await prisma.$transaction((tx) => saveResults(tx, userId, page.id, results));
    expect(await counts()).toMatchObject({ items: 1, senses: 1, sightings: 1, cards: 1 });
  });

  it('rolls back everything if saving fails partway', async () => {
    const { page, marks } = await createPage([
      { type: 'underline_save', text: '가까스로', normalForm: '가까스로' },
      { type: 'underline_translate', text: '너무나 기뻤다.' },
      { type: 'curly', text: '비록', normalForm: '비록' },
    ]);
    const results: ExplainResult[] = [
      { markId: marks[0].id, kind: 'new', meaning: 'barely', notes: 'n', example: 'e', exampleTranslation: 'et', sentenceTranslation: 'st' },
      { markId: marks[1].id, kind: 'translation', translation: 'I was so happy.' },
      // A sense that does not exist: the database refuses this last write.
      { markId: marks[2].id, kind: 'existing', senseId: crypto.randomUUID(), sentenceTranslation: 'st' },
    ];
    await expect(prisma.$transaction((tx) => saveResults(tx, userId, page.id, results))).rejects.toThrow();
    expect(await counts()).toEqual({ items: 0, senses: 0, sightings: 0, cards: 0, translations: 0 });
  });

  it('moves to DONE after saving, and to FAILED with failed_stage EXPLAINING after attempt 3', async () => {
    const { page } = await createPage([{ type: 'underline_save', text: '가까스로', normalForm: '가까스로' }]);
    fake.queue({ error: new AiTransientError('timeout') }, { error: new AiTransientError('timeout') }, { error: new AiTransientError('timeout') });
    await expect(processor.process(job(page.id, 0))).rejects.toBeInstanceOf(AiTransientError);
    await expect(processor.process(job(page.id, 1))).rejects.toBeInstanceOf(AiTransientError);
    expect(await pageStatus(page.id)).toBe('EXPLAINING');
    await expect(processor.process(job(page.id, 2))).rejects.toBeInstanceOf(AiTransientError);
    const failed = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(failed).toMatchObject({ status: 'FAILED', failedStage: 'EXPLAINING' });
    expect(failed.failureReason).toMatch(/try again/i);
  });

  it('logs both AI calls with the page and user', async () => {
    await prisma.aiCall.deleteMany();
    const { page, marks } = await createPage([{ type: 'underline_save', text: '겁먹고', normalForm: null, sentence: null, source: 'added' }]);
    fake.queue(
      { output: { marks: [{ mark_id: marks[0].id, normal_form: '겁먹다', sentence: null }] }, inputTokens: 900, outputTokens: 50 },
      { ...explained(fresh(marks[0].id, 'to get scared')), inputTokens: 1200, outputTokens: 300 },
    );
    await processor.process(job(page.id));
    const calls = await prisma.aiCall.findMany({ where: { pageId: page.id }, orderBy: { createdAt: 'asc' } });
    expect(calls.map((c) => [c.purpose, c.userId, c.inputTokens])).toEqual([
      ['resolve', userId, 900],
      ['explain', userId, 1200],
    ]);
  });

  it('runs in the worker process: takes the queued job and finishes the page', async () => {
    const { page, marks } = await createPage([{ type: 'underline_save', text: '가까스로', normalForm: '가까스로' }]);
    fake.queue(explained(fresh(marks[0].id, 'barely')));
    const app = moduleRef.createNestApplication();
    await app.init();
    const queue = new Queue(EXPLANATION_QUEUE, { connection: createRedisConnection(redis.url, { forWorker: true }) });
    try {
      await queue.add('explain', { pageId: page.id }, { ...PAGE_JOB_OPTIONS, jobId: `explain-${page.id}` });
      await expect.poll(() => pageStatus(page.id), { timeout: 15_000 }).toBe('DONE');
    } finally {
      await queue.close();
      await app.close();
    }
  });
});
