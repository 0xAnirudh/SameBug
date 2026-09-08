import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // mongodb-memory-server downloads a binary on first run and integration
    // tests spin up real servers, so the default 5s is not enough.
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
