import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Integration tests start real services in Docker, so they run separately from unit tests.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
