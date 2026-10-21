import { expect, test } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

const ist = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const oneLine = [{ description: 'Goods', quantity: '1', rate: '1000', taxRateBp: 1800 }];

test('a bill from a micro vendor past 45 days shows the MSME warning, and it goes once paid', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Buyer Co');

  await page.goto('/app/vendors');
  await page.getByLabel('Name', { exact: true }).fill('Tiny Works');
  await page.getByLabel('State').selectOption('27');
  await page.getByLabel('Udyam number (if they are an MSME)').fill('UDYAM-MH-12-0001234');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await expect(page.getByRole('alert')).toContainText('micro, small or medium');
  await page.getByLabel('Size of enterprise').selectOption('micro');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await expect(page.getByRole('table', { name: 'Vendors' })).toContainText('Tiny Works');

  const vendors = await (await page.request.get('/api/parties?kind=vendor')).json();
  const partyId = vendors.parties[0].id;
  const bill = await (await page.request.post('/api/purchases', { data: { partyId, billNumber: 'TW-1', billDate: ist(-50), lines: oneLine } })).json();

  await page.goto('/app/vendors');
  await expect(page.getByTestId('msme-panel')).toContainText('Overdue by 5 days');
  await page.goto('/app/purchases');
  await expect(page.getByText('MSME overdue')).toBeVisible();
  await page.goto(`/app/purchases/${bill.id}`);
  await expect(page.getByTestId('msme-warning')).toContainText('Past the 45-day limit by 5 days');

  await page.getByLabel('Amount paid (Rs)').fill('1180');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('msme-warning')).toHaveCount(0);
});
