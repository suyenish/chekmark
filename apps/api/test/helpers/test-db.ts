import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const run = promisify(execFile);
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Same major version as docker-compose.yml. */
export const POSTGRES_IMAGE = 'postgres:18-alpine';

/**
 * Starts a throwaway PostgreSQL in Docker and applies the real migrations,
 * so tests check the schema that production uses.
 */
export async function startTestDb(): Promise<{ prisma: PrismaClient; url: string; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  try {
    await run(path.join(API_DIR, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
    });
  } catch (error) {
    await container.stop();
    throw error;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return {
    prisma,
    url,
    async stop() {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
