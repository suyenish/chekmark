import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Local commands read DATABASE_URL from the repository's .env. Tests and deployment set it directly.
if (!process.env.DATABASE_URL && existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
