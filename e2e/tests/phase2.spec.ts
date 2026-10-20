import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

async function customerWithInvoice(page: import('@playwright/test').Page, name: string, rate: string) {
  await page.request.post('/api/parties', { data: { kind: 'customer', name, stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties.find((p: { name: string }) => p.name === name);
  const doc = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${doc.id}/issue`, { data: {} });
  return { partyId: party.id as string, docId: doc.id as string };
}

test('an advance is held on the customer, applied to an invoice in one click, and the invoice is marked paid', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  const { partyId, docId } = await customerWithInvoice(page, 'Advance Payer', '3000');

  await page.goto(`/app/customers/${partyId}`);
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByTestId('credit-held')).toHaveText('Rs 0.00');
  await page.getByLabel('Amount received (Rs)').fill('5000');
  await page.getByRole('button', { name: 'Record advance' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Advance recorded.' })).toBeVisible();
  await expect(page.getByTestId('credit-held')).toHaveText('Rs 5,000.00');

  await page.goto(`/app/invoices/${docId}`);
  await page.getByRole('button', { name: /Apply Rs 3,000.00 held for this customer/ }).click();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  const paper = page.frameLocator('iframe[title="Document preview"]');
  await expect(paper.locator('.paidtag')).toBeVisible();

  await page.goto(`/app/customers/${partyId}`);
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByTestId('credit-held')).toHaveText('Rs 2,000.00');

  // return part of what is left
  await page.getByRole('button', { name: 'Refund' }).click();
  await page.getByLabel('Amount to return (Rs)').fill('500');
  await page.getByRole('button', { name: 'Record refund' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Refund recorded.' })).toBeVisible();
  await expect(page.getByTestId('credit-held')).toHaveText('Rs 1,500.00');

  // more than is held is refused in plain words
  await page.getByRole('button', { name: 'Refund' }).click();
  await page.getByLabel('Amount to return (Rs)').fill('9999');
  await page.getByRole('button', { name: 'Record refund' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Only 1500.00 is held' })).toBeVisible();
});

test('an invoice can be issued already paid, as at a counter', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Counter Buyer', desc: 'Goods', rate: '1000', gst: '500' });
  await page.getByLabel('The customer has paid in full').check();
  await page.getByLabel('Paid by').selectOption('upi');
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await expect(page.locator('.chip').first()).toHaveText('Paid');
  const paper = page.frameLocator('iframe[title="Document preview"]');
  await expect(paper.locator('.paidtag')).toBeVisible();
});
