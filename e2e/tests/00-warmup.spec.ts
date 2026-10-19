import { test } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

// The dev server compiles each route the first time it is hit, which can take seconds on a slow machine.
// Touch every page and API once so the timed tests measure the app, not Next's first compile.
test('warm up routes', async ({ page, context }) => {
  test.setTimeout(240_000);
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  for (const path of ['/', '/login', '/setup', '/app/invoices', '/app/invoices/new', '/app/customers', '/app/items', '/app/settings']) {
    await page.goto(path); await page.getByRole('heading').first().waitFor();
  }
  for (const api of ['/api/me', '/api/business', '/api/parties', '/api/items', '/api/documents', '/api/template']) await page.request.get(api);
  const d = await page.request.post('/api/documents', { data: { docType: 'tax_invoice', lines: [{ name: 'w', hsnSac: '998313', quantity: '1', rate: '1', taxRateBp: 1800 }] } });
  const id = (await d.json()).id;
  await page.request.post('/api/documents/preview', { data: { docType: 'tax_invoice', lines: [{ name: 'w', quantity: '1', rate: '1', taxRateBp: 1800 }] } });
  await page.request.post('/api/template/preview', { data: {} });
  await page.request.post(`/api/documents/${id}/issue`, { data: {} });
  await page.request.get(`/api/documents/${id}/html`);
  await page.request.get(`/api/documents/${id}/pdf`);
  const s = await page.request.post(`/api/documents/${id}/share`, { data: {} });
  const url = (await s.json()).url as string;
  await page.request.get(url); await page.request.get(url + '/pdf');
  await page.request.post(`/api/documents/${id}/send`, { data: { channel: 'whatsapp', to: '9876543210' } });
  await page.request.post(`/api/documents/${id}/note`, { data: { kind: 'credit_note' } });
  await page.goto(`/app/invoices/${id}`); await page.getByRole('heading').first().waitFor();
  await page.request.post('/api/auth/request', { data: { identifier: '9000000000' } });
  await page.request.post('/api/auth/verify', { data: { identifier: '9000000000', code: '000000' } });
});
