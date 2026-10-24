import { expect, test } from '@playwright/test';

// The suite runs the production build with the staging mock switches on (KORA_ALLOW_MOCKS and friends, see playwright.config.ts).
// That is exactly what the health check must refuse to call healthy in production, so it answers 503 with the reason and no names.
test('health reports a mock switch that is on in production as down, without naming it', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({ status: 'down', reason: 'config' });
});
