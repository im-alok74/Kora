// Targeted run against an already running dev or production server: KORA_BASE=http://localhost:3420 pnpm exec playwright test -c playwright.polish.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /public-polish\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.KORA_BASE ?? 'http://localhost:3420' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
