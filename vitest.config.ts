import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'], exclude: ['**/*.db.test.ts'] } },
      {
        test: {
          name: 'db',
          include: ['packages/*/src/**/*.db.test.ts', 'apps/*/src/**/*.db.test.ts', 'tests/integration/**/*.test.ts'],
          fileParallelism: false,
          globalSetup: ['tests/db-global-setup.ts'],
          setupFiles: ['tests/db-env.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
