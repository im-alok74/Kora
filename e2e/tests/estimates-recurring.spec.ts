import { expect, test, type BrowserContext } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

test('an estimate is accepted, then turned into an invoice once', async ({ page, context }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Quote Buyer', stateCode: '27' } })).json();
  const est = await (await page.request.post('/api/documents', { data: { docType: 'estimate', partyId: party.id, dueDate: addDays(istToday(), 14),
    lines: [{ name: 'Website', hsnSac: '998314', quantity: '1', rate: '5000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${est.id}/issue`, { data: {} });

  await page.goto(`/app/invoices/${est.id}`);
  await expect(page.getByTestId('estimate-status')).toHaveText('Open');
  await expect(page.getByText(/valid until/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark accepted' }).click();
  await expect(page.getByText('Marked as accepted.')).toBeVisible();
  await expect(page.getByTestId('estimate-status')).toHaveText('Accepted');

  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByLabel('Line 1 description')).toHaveValue('Website');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 5,900.00');

  await page.goto(`/app/invoices/${est.id}`);
  await expect(page.getByTestId('estimate-status')).toHaveText('Invoiced');
  await expect(page.getByRole('link', { name: /View invoice/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convert to invoice' })).toHaveCount(0);
  await page.goto('/app/invoices');
  await expect(page.getByRole('row', { name: /EST\// })).toContainText('Invoiced');
});

test('an expired estimate cannot be accepted or converted', async ({ page, context }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Late Buyer', stateCode: '27' } })).json();
  const est = await (await page.request.post('/api/documents', { data: { docType: 'estimate', partyId: party.id, dueDate: addDays(istToday(), -1),
    lines: [{ name: 'Audit', hsnSac: '998311', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${est.id}/issue`, { data: {} });
  await page.goto(`/app/invoices/${est.id}`);
  await expect(page.getByTestId('estimate-status')).toHaveText('Expired');
  await expect(page.getByRole('button', { name: 'Convert to invoice' })).toHaveCount(0);
  const r = await page.request.post(`/api/documents/${est.id}/estimate`, { data: { action: 'convert' } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toContain('expired');
});

test('a recurring invoice is set up, made by the worker on its date, and can be paused', async ({ page, context }) => {
  test.setTimeout(120_000);
  await owner(context);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Monthly Client', stateCode: '27' } });
  await page.goto('/app/recurring');
  await expect(page.getByText('No recurring invoices yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New recurring invoice' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Monthly retainer');
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Monthly Client' });
  await page.getByLabel('First invoice on').fill(istToday());
  await page.getByLabel('On each date').selectOption('issue');
  await page.getByLabel('Line 1 description').fill('Retainer');
  await page.getByLabel('Line 1 HSN or SAC').fill('998313');
  await page.getByLabel('Line 1 rate').fill('2000');
  await page.getByRole('button', { name: 'Save recurring invoice' }).click();
  await expect(page.getByText('Recurring invoice saved.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Monthly retainer/ })).toContainText('Every month');

  // the worker makes today's invoice on its own
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row', { name: /Monthly retainer/ }).getByRole('cell').nth(5)).toHaveText('1', { timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('link', { name: /INV\// })).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Paused')).toHaveCount(0);

  // a template that is not a valid invoice is refused up front
  await page.getByRole('button', { name: 'New recurring invoice' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Broken');
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Monthly Client' });
  await page.getByLabel('Line 1 description').fill('Thing');
  await page.getByLabel('Line 1 rate').fill('abc');
  await page.getByRole('button', { name: 'Save recurring invoice' }).click();
  await expect(page.locator('p[role="alert"]')).toBeVisible();
});

test('a bad recurring request is refused cleanly, never as a server error', async ({ page, context }) => {
  await owner(context);
  const r = await page.request.post('/api/recurring', { data: { name: 'x', partyId: '00000000-0000-0000-0000-000000000000', unit: 'month', startDate: istToday(), lines: [] } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(r.status()).toBeLessThan(500);
});
