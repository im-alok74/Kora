import { expect, test } from '@playwright/test';

const SECRET = 'e2e-cron-secret-0123456789';

test('the background tick refuses anyone without the secret, and runs one pass for the scheduler', async ({ request }) => {
  expect((await request.get('/api/cron/tick')).status()).toBe(401);
  expect((await request.get('/api/cron/tick', { headers: { authorization: 'Bearer wrong-secret-0123456789' } })).status()).toBe(401);
  expect((await request.get('/api/cron/tick', { headers: { authorization: `Bearer ${SECRET.slice(0, -1)}` } })).status()).toBe(401);
  const ok = await request.get('/api/cron/tick', { headers: { authorization: `Bearer ${SECRET}` } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.ok).toBe(true);
  expect(body.jobs).toMatchObject({ claimed: expect.any(Number), done: expect.any(Number), retried: expect.any(Number), failed: expect.any(Number) });
  expect(body.reminders).toBeDefined();
  expect(body.recurring).toBeDefined();
  expect(body.ms).toBeLessThan(45_000);
});
