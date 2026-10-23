import { defineConfig } from '@playwright/test';

// Public-page checks against a running local preview; never touches the test database.
export default defineConfig({
  testDir: './tests', testMatch: 'public-install.spec.ts', workers: 1,
  timeout: 60_000, expect: { timeout: 15_000 },
  use: { baseURL: process.env.KORA_PUBLIC_TEST_URL || 'http://localhost:3000', reducedMotion: 'reduce', screenshot: 'only-on-failure' },
});
