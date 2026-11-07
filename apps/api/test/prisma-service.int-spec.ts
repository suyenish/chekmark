import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../src/config/config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { startTestDb } from './helpers/test-db.js';

describe('PrismaService', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  it('connects with the database address from the settings', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, { provide: APP_CONFIG, useValue: loadConfig({ DATABASE_URL: db.url }) }],
    }).compile();
    await moduleRef.init();

    const prisma = moduleRef.get(PrismaService);
    await prisma.user.create({ data: { email: 'service@example.com' } });
    expect(await prisma.user.count()).toBe(1);

    await moduleRef.close();
  });
});
