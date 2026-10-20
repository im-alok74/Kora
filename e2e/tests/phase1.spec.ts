import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

test('default notes and terms fill a new document, extra details and a salesperson print, and the preview shows the draft', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);

  await page.goto('/app/settings');
  await page.getByLabel('Default notes').fill('Thank you for your business.');
  await page.getByLabel('Default terms').fill('Payment within 15 days.');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();

  await page.goto('/app/invoices/new');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Thank you for your business.');
  await expect(page.getByLabel('Terms', { exact: true })).toHaveValue('Payment within 15 days.');

  await fillInvoice(page, { customer: 'Preview Buyer', desc: 'Site survey', rate: '2500' });
  await page.getByLabel('Salesperson').fill('Asha Rao');
  await page.getByRole('button', { name: 'Add an extra detail' }).click();
  await page.getByLabel('Extra detail 1 name').fill('Vehicle no.');
  await page.getByLabel('Extra detail 1 value').fill('MH12 AB 1234');
  await page.getByLabel('Order or PO number').fill('PO-88');

  await page.getByRole('tab', { name: 'Preview' }).click();
  const frame = page.frameLocator('iframe[title="Draft preview"]');
  await expect(frame.getByText('Site survey')).toBeVisible();
  await expect(frame.getByText('MH12 AB 1234')).toBeVisible();
  await expect(frame.getByText('Asha Rao')).toBeVisible();
  await expect(frame.getByText('PO-88')).toBeVisible();
  await expect(frame.getByText('Payment within 15 days.')).toBeVisible();
  await expect(frame.getByText('2,950.00').first()).toBeVisible();

  // editing while the preview is open changes the paper
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByLabel('Line 1 rate').fill('3000');
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(frame.getByText('3,540.00').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const paper = page.frameLocator('iframe[title="Document preview"]');
  await expect(paper.getByText('Vehicle no.')).toBeVisible();
  await expect(paper.getByText('Asha Rao')).toBeVisible();
});

test('a half-filled extra detail is refused with a clear message', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Strict Buyer', desc: 'Item', rate: '100' });
  await page.getByRole('button', { name: 'Add an extra detail' }).click();
  await page.getByLabel('Extra detail 1 name').fill('Only a name');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'both a name and a value' })).toBeVisible();
});

test('a file can be attached to an issued invoice, opened, and removed', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Files Buyer', desc: 'Supply', rate: '1000' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();

  await page.getByLabel('Add a file').setInputFiles({ name: 'purchase-order.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n') });
  await expect(page.getByRole('link', { name: 'purchase-order.pdf' })).toBeVisible();
  const href = await page.getByRole('link', { name: 'purchase-order.pdf' }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');

  await page.getByLabel('Add a file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf at all') });
  await expect(page.getByRole('alert').filter({ hasText: 'does not look like a real file' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove purchase-order.pdf' }).click();
  await expect(page.getByRole('link', { name: 'purchase-order.pdf' })).toHaveCount(0);
});
