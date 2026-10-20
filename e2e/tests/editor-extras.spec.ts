import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

test('payment terms fill the due date, and a discount on the whole bill is shared over the lines', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Terms Buyer', desc: 'Design work', rate: '1000' });

  await page.getByLabel('Date', { exact: true }).fill('2026-10-20');
  await page.getByLabel('Payment terms').selectOption('net30');
  await expect(page.getByLabel('Due date')).toHaveValue('2026-11-19');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-25');                          // changing the date moves the due date
  await expect(page.getByLabel('Due date')).toHaveValue('2026-11-24');
  await page.getByLabel('Due date').fill('2026-12-31');                                         // typing a date takes over
  await expect(page.getByLabel('Payment terms')).toHaveValue('custom');

  await page.getByLabel('Order or PO number').fill('PO-5521');
  await page.getByLabel('Subject').fill('Brand refresh');

  // 1000 plus shipping, then Rs 100 off the whole bill
  await page.getByRole('button', { name: 'Add shipping charge' }).click();
  await page.getByLabel('Line 2 rate').fill('200');
  await expect(page.getByLabel('Line 2 GST rate')).toHaveValue('1800');
  await page.getByLabel('Discount on the whole bill').fill('120');
  // 1200 less 120 = 1080, plus 18% = 1274.40, which the document rounds to the rupee
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,274.00');
  await page.getByLabel('Line 1 discount').fill('10%');                                         // a percentage on one line: 100 off line 1
  // line 1 is 900, line 2 is 200; Rs 120 off the 1100 left shares as 98.18 and 21.82, so 1100 - 120 = 980; tax 176.40, total 1156.40 rounded
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,156.00');

  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await expect(page.getByText('Brand refresh')).toBeVisible();
  await expect(page.getByText('PO PO-5521')).toBeVisible();
  const frame = page.frameLocator('iframe[title="Document preview"]');
  await expect(frame.getByText('PO-5521')).toBeVisible();
  await expect(frame.getByText('Brand refresh')).toBeVisible();
  await expect(frame.getByText('2026-12-31')).toBeVisible();
});

test('duplicating an invoice opens a new draft with the same lines', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Repeat Buyer', desc: 'Monthly retainer', rate: '5000' });
  await page.getByLabel('Order or PO number').fill('RET-1');
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+\/edit/);
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByLabel('Line 1 description')).toHaveValue('Monthly retainer');
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('5000.00');
  await expect(page.getByLabel('Order or PO number')).toHaveValue('RET-1');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 5,900.00');
});
