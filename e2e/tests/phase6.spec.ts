import { expect, test } from '@playwright/test';
import { gstin, makeBusiness, signedIn, db } from '../helpers';

async function goodsInvoice(page: import('@playwright/test').Page, businessId: string, rate: string) {
  await db`update business set address = ${db.json({ line1: '12 MG Road', city: 'Pune', pincode: '411001' })} where id = ${businessId}`;
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Bengaluru Builders', gstin: gstin('29'), stateCode: '29', billingAddress: { line1: '5 Lane', city: 'Bengaluru', pincode: '560001' } } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Steel rods', hsnSac: '7214', quantity: '10', rate, unit: 'KGS', taxRateBp: 1800, kind: 'goods' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  return d.id as string;
}

test('an e-way bill is checked, made through the partner, shown with its validity, and cancelled', async ({ page, context }) => {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  const id = await goodsInvoice(page, b.businessId, '6000');
  await page.goto(`/app/invoices/${id}`);
  const panel = page.getByRole('region', { name: 'E-way bill' });
  await expect(panel).toContainText('worth more than Rs 50,000');

  // an empty journey is explained, not sent
  await panel.getByRole('button', { name: 'Check' }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'distance must be a whole number' })).toBeVisible();

  await panel.getByLabel('Distance (km)').fill('840');
  await panel.getByLabel('Vehicle number').fill('mh12 ab 1234');
  await panel.getByRole('button', { name: 'Check' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'looks right' })).toBeVisible();

  await panel.getByRole('button', { name: 'Make the e-way bill' }).click();
  await expect(panel.getByRole('status').filter({ hasText: /E-way bill \d{12} made\./ })).toBeVisible();
  const row = panel.getByRole('table', { name: 'E-way bills made' }).getByRole('row').nth(1);
  await expect(row).toContainText('Active');
  await expect(row).toContainText('MH12AB1234');
  await expect(panel.getByRole('button', { name: 'Make the e-way bill' })).toHaveCount(0);          // one active bill at a time

  await row.getByRole('button', { name: 'Cancel' }).click();
  await panel.getByLabel('Remark').fill('Wrong vehicle');
  await panel.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'E-way bill cancelled.' })).toBeVisible();
  await expect(panel.getByRole('table', { name: 'E-way bills made' })).toContainText('Cancelled');
  await expect(panel.getByRole('button', { name: 'Make the e-way bill' })).toBeVisible();           // a new one can be made
});

test('the JSON for the portal can be downloaded, and a service invoice is told it needs none', async ({ page, context }) => {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  const id = await goodsInvoice(page, b.businessId, '500');
  await page.goto(`/app/invoices/${id}`);
  const panel = page.getByRole('region', { name: 'E-way bill' });
  await expect(panel).toContainText('Rs 50,000 or less');
  await panel.getByLabel('Distance (km)').fill('120');
  await panel.getByLabel('Vehicle number').fill('MH12AB1234');
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download JSON for the portal' }).click()]);
  expect(download.suggestedFilename()).toBe('eway-bill.json');
  const json = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'));
  expect(json.version).toBe('1.0.0421');
  expect(json.billLists[0]).toMatchObject({ docType: 'INV', fromPincode: 411001, toPincode: 560001, transDistance: '120', vehicleNo: 'MH12AB1234' });

  const sId = await (async () => {
    const party = (await (await page.request.get('/api/parties')).json()).parties[0];
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Consulting', hsnSac: '998313', quantity: '1', rate: '90000', taxRateBp: 1800, kind: 'service' }] } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  })();
  await page.goto(`/app/invoices/${sId}`);
  await expect(page.getByRole('region', { name: 'E-way bill' })).toContainText('Services do not need an e-way bill');
});

test('the TDS report shows what customers will deduct and what is still to receive', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Deductor Ltd', stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, tdsBp: 1000, lines: [{ name: 'Consulting', hsnSac: '998313', quantity: '1', rate: '10000', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.request.post(`/api/documents/${d.id}/payments`, { data: { amount: '400', method: 'tds' } });
  const r = await (await page.request.get('/api/reports/tds')).json();
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({ customer: 'Deductor Ltd', invoices: 1, expected: '100000', received: '40000', pending: '60000' });
  await page.goto('/app/reports');
  await page.getByRole('tab', { name: 'TDS deducted' }).or(page.getByRole('button', { name: 'TDS deducted' })).first().click();
  await expect(page.getByRole('table', { name: 'TDS deducted by customers' })).toContainText('Deductor Ltd');
});
