import { createServer } from 'node:net';
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

const REUSE = !!process.env.KORA_E2E_REUSE;
const CI = !!process.env.CI;

/** True when something already listens on the port (a stale server from an interrupted run). */
const busy = (port: number) => new Promise<boolean>((done) => {
  const s = createServer().once('error', () => done(true)).once('listening', () => s.close(() => done(false)));
  s.listen(port);
});

// Playwright's own message for this is "http://127.0.0.1:3202/healthz is already used", which does not say what to do.
// Only in the runner: every test worker loads this file again, and by then the servers are meant to be listening.
if (!REUSE && process.env.TEST_WORKER_INDEX === undefined && !process.argv.includes('--list')) {
  const taken = (await Promise.all([PORT, WORKER_PORT, GSP_PORT].map(async (p) => ((await busy(p)) ? p : 0)))).filter(Boolean);
  if (taken.length) {
    throw new Error(`Port ${taken.join(', ')} is already in use: a web, worker or mock GSP server from an earlier e2e run is still running. `
      + 'Stop it (Windows: netstat -ano | findstr :3200, then taskkill /F /T /PID <pid>; elsewhere: lsof -i :3200) or set KORA_E2E_REUSE=1 to run against it.');
  }
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,        // in CI one retry, and a test that needed it is reported as flaky instead of failing the run
  reporter: [['list']],
  // Reduced motion: entrance animations fade text in, and axe scans taken mid-fade intermittently reported contrast failures on pages that are fine once settled.
  use: { baseURL: `http://localhost:${PORT}`, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The database is rebuilt here, before the web and worker servers start, so a rerun never meets rows from the last one.
      // Not when reusing servers: dropping the database under a running server would break it.
      command: `${REUSE ? '' : 'pnpm exec tsx scripts/prepare-db.ts && '}pnpm --filter @kora/mock-gsp start`,
      url: `http://127.0.0.1:${GSP_PORT}/healthz`,
      timeout: 60_000,
      reuseExistingServer: !!process.env.KORA_E2E_REUSE,
      env: { PORT: String(GSP_PORT) },
    },
    {
      // Production build, as deployed. Mocks need the explicit staging switch.
      // CI builds once in its own job and hands the build to every shard (E2E_PREBUILT=1); everywhere else the build happens here.
      command: `${process.env.E2E_PREBUILT ? '' : 'pnpm --filter @kora/web build && '}pnpm --filter @kora/web exec next start -p ${PORT} --keepAliveTimeout 65000`,
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
