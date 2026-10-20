import { defineConfig, devices } from '@playwright/test';

export const PORT = 3200;
export const SECRET = 'e2e-secret-e2e-secret-e2e-secret-123456';
export const GATEWAY_SECRET = 'e2e-gateway-secret-0123456789';
export const WORKER_PORT = 3201;
export const GSP_PORT = 3202;
const ENV = {
  DATABASE_URL: 'postgres://kora_web:kora_web_dev@localhost:54329/kora_e2e',
  CRON_SECRET: 'e2e-cron-secret-0123456789', OTP_HMAC_SECRET: SECRET, OTP_PROVIDER: 'mock', GATEWAY: 'mock', GATEWAY_WEBHOOK_SECRET: GATEWAY_SECRET, MESSENGER: 'mock',
  KORA_WEBHOOK_ALLOW_PRIVATE: '1',   // lets the browser tests receive webhooks on localhost
  APP_URL: `http://localhost:${PORT}`, GSP_URL: `http://127.0.0.1:${GSP_PORT}`, GSP_TIMEOUT_MS: '5000',
};

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @kora/mock-gsp start',
      url: `http://127.0.0.1:${GSP_PORT}/healthz`,
      timeout: 60_000,
      reuseExistingServer: !!process.env.KORA_E2E_REUSE,
      env: { PORT: String(GSP_PORT) },
    },
    {
      // Production build, as deployed. Mocks need the explicit staging switch.
      command: `pnpm --filter @kora/web build && pnpm --filter @kora/web exec next start -p ${PORT} --keepAliveTimeout 65000`,
      url: `http://localhost:${PORT}`,
      timeout: 600_000,
      reuseExistingServer: !!process.env.KORA_E2E_REUSE,
      env: { ...ENV, KORA_ALLOW_MOCKS: '1', NEXT_DIST_DIR: '.next-e2e' },
    },
    {
      command: 'pnpm --filter @kora/worker start',
      url: `http://localhost:${WORKER_PORT}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !!process.env.KORA_E2E_REUSE,
      env: { ...ENV, WORKER_HEALTH_PORT: String(WORKER_PORT), REMINDER_TICK_MS: '2000', RECURRING_TICK_MS: '2000', KORA_ALLOW_MOCKS: '1' },
    },
  ],
});
