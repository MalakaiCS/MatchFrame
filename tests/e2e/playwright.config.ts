import { defineConfig } from '@playwright/test';

// Runs against a running stack (pnpm dev or the production build): E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD.
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../../docs/evidence/e2e/results.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    launchOptions: { executablePath: process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: '../../.data/e2e-artifacts',
});
