import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@remote-browser/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include:
      process.env.RUN_BROWSER_TESTS === '1'
        ? ['tests/**/*.integration.ts']
        : ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: process.env.RUN_BROWSER_TESTS === '1' ? 45_000 : 10_000,
    hookTimeout: 30_000,
  },
});
