import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end test of the whole app running in containers. Start it first:
 *   AI_PROVIDER=fake docker compose --profile app up -d --build
 * then run: pnpm e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  // A phone-sized Chromium, since the app is built for phones.
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
});
