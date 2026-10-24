import { expect, test } from '@playwright/test';
import { gstin, makeBusiness, signedIn } from '../helpers';

test('a bill is recorded from a vendor in another state, paid in parts, and shows in input credit', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Buyer Co');
  const vendorGstin = gstin('24');
  const v = await (await page.request.post('/api/parties', { data: { kind: 'vendor', name: 'Gujarat Steel', stateCode: '24', gstin: vendorGstin } })).json();
  expect(v.id).toBeTruthy();

  await page.goto('/app/purchases');
  await expect(page.getByRole('heading', { name: 'Purchases', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No bills here.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New bill' }).click();
  await page.getByLabel('Vendor', { exact: true }).selectOption({ label: 'Gujarat Steel' });
  await page.getByLabel("Vendor's bill number").fill('GS/0042');
  await page.getByLabel('Line 1 description').fill('Steel rods');
  await page.getByLabel('Line 1 HSN or SAC').fill('7214');
  await page.getByLabel('Line 1 rate').fill('10000');
  await page.getByRole('button', { name: 'Record bill' }).click();
  await expect(page.getByRole('heading', { name: 'Bill GS/0042', exact: true })).toBeVisible();
  await expect(page.getByTestId('bill-total')).toHaveText('Rs 11,800.00');
  await expect(page.getByRole('table', { name: 'Bill lines' })).toContainText('Steel rods');
  await expect(page.getByLabel('Totals')).toContainText('IGST');

  await page.getByLabel('Amount paid (Rs)').fill('5000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Payment recorded.' })).toBeVisible();
  await expect(page.getByText('Rs 6,800.00 owed')).toBeVisible();
  await page.getByLabel('Amount paid (Rs)').fill('9000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'still due' })).toContainText('Only Rs 6800.00 is still due');

  // a repeated bill number from the same vendor is refused
  const dup = await page.request.post('/api/purchases', { data: { partyId: v.id, billNumber: 'gs/0042', billDate: '2026-10-01', lines: [{ description: 'x', quantity: '1', rate: '1', taxRateBp: 1800 }] } });
  expect(dup.status()).toBe(400);

  // the credit appears for the month of the bill, and a statement from the portal shows what the supplier filed
  const month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
  await page.goto('/app/itc');
  await page.getByLabel('Month').fill(month);
  await expect(page.getByTestId('itc-eligible')).toHaveText('Rs 1,800.00');
  const stmt = { data: { docdata: { b2b: [{ ctin: vendorGstin, trdnm: 'Gujarat Steel', inv: [
    { inum: 'GS-0042', dt: '05-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 10000, rt: 18, igst: 1800 }] },
    { inum: 'GS-0099', dt: '07-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 2000, rt: 18, igst: 360 }] },
  ] }] } } };
  await page.getByLabel('GSTR-2B JSON file').setInputFiles({ name: '2b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stmt)) });
  await expect(page.getByRole('status').filter({ hasText: 'Loaded 2 supplier invoices. 1 match your bills.' })).toBeVisible();
  await expect(page.getByTestId('rc-matched')).toHaveText('1');
  await expect(page.getByTestId('rc-only2b')).toHaveText('1');
  await expect(page.getByTestId('rc-onlybooks')).toHaveText('0');
  await page.getByRole('button', { name: 'Add as a bill' }).click();
  await expect(page.getByRole('heading', { name: 'Bill GS-0099', exact: true })).toBeVisible();
  await expect(page.getByText(/Found in the supplier.s GSTR-2B/)).toBeVisible();

  // blocked credit needs a reason
  await page.getByRole('button', { name: 'Block this credit' }).click();
  await page.getByLabel('Why is the credit blocked?').fill('Personal use');
  await page.getByRole('button', { name: 'Block credit' }).click();
  await expect(page.getByText('Personal use')).toBeVisible();

  // the GSTR-3B summary now has a table 4
  const r = await page.request.get(`/api/reports/gstr3b?period=${month}`);
  expect(r.ok()).toBe(true);
  const j = await r.json();
  expect(j.table4).toHaveLength(3);
  expect(j.json.itc_elg.itc_avl.find((x: { ty: string }) => x.ty === 'OTH').iamt).toBe(1800);
});
