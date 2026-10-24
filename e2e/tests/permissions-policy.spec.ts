import { expect, test } from '@playwright/test';

// B-1 / T-1: the scanners open the camera, so only they may; everywhere else it stays blocked.
const policy = async (request: import('@playwright/test').APIRequestContext, path: string) => (await request.get(path)).headers()['permissions-policy'];

test('the camera is allowed on the two scanner pages and nowhere else', async ({ request }) => {
  for (const p of ['/tools/barcode-scanner', '/tools/qr-code-scanner']) expect(await policy(request, p), p).toMatch(/camera=\(self\)/);
  for (const p of ['/', '/login', '/tools', '/tools/gst-calculator', '/tools/barcode-generator', '/pricing']) expect(await policy(request, p), p).toMatch(/camera=\(\)/);
});

test('the other features stay blocked on the scanner pages too', async ({ request }) => {
  const v = await policy(request, '/tools/barcode-scanner');
  expect(v).toContain('microphone=()');
  expect(v).toContain('geolocation=()');
  expect(v).toContain('payment=()');
});
