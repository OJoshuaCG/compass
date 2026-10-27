import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    // Real PostgreSQL in a container: the first pull/start can take a while.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
