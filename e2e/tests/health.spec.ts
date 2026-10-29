import { expect, test } from '@playwright/test';

// The suite runs the production build with the staging mock switches on (KORA_ALLOW_MOCKS and friends, see playwright.config.ts).
// That is exactly what the health check must refuse to call healthy in production. The public answer says only "down"; the reason
// (never a variable name) goes to the operator who sends the cron secret.
test('health reports a mock switch that is on in production as down, and names the reason only to the operator', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({ status: 'down' });
  const op = await request.get('/api/health', { headers: { authorization: 'Bearer e2e-cron-secret-0123456789' } });
  expect(op.status()).toBe(503);
  expect(await op.json()).toEqual({ status: 'down', reason: 'config' });
  const wrong = await request.get('/api/health', { headers: { authorization: 'Bearer not-the-secret-not-the-secret' } });
  expect(await wrong.json()).toEqual({ status: 'down' });
});
