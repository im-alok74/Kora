import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeBusiness, signedIn } from '../helpers';

test('quotation details survive conversion, PDF and two payments with receipts', async ({ page, context }) => {
  const faults: string[] = [];
  page.on('pageerror', e => faults.push(e.message));
  // axe tries to inject itself into the sandboxed document previews and the browser logs that refusal; it is the scanner, not the app
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Blocked script execution in')) faults.push(m.text()); });
  page.on('response', r => { if (r.status() >= 500) faults.push(`${r.status()} ${r.url()}`); });
  const user = await signedIn(context);
  await makeBusiness(user.userId, 'Kora Journey Test');
  const partyResponse = await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Maple Studio', stateCode: '27' } });
  expect(partyResponse.ok()).toBeTruthy();
  const party = await partyResponse.json();
  const quoteResponse = await page.request.post('/api/documents', { data: { docType: 'estimate', partyId: party.id,
    reference: 'PO-402', subject: 'Website refresh', paymentTerms: 'net30', salesperson: 'Asha', extra: [{ label: 'Project', value: 'WEB-26' }],
    lines: [{ name: 'Design consultation', hsnSac: '998313', quantity: '2', rate: '2500', taxRateBp: 1800, kind: 'service' }] } });
  expect(quoteResponse.ok()).toBeTruthy();
  const quote = await quoteResponse.json();
  expect((await page.request.post(`/api/documents/${quote.id}/issue`, { data: {} })).ok()).toBeTruthy();
  await page.goto(`/app/invoices/${quote.id}`);
  await page.getByRole('button', { name: 'Mark accepted' }).click();
  await page.getByRole('button', { name: 'Save answer' }).click();
  await expect(page.getByTestId('estimate-status')).toHaveText('Accepted');
  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByLabel('Order or PO number')).toHaveValue('PO-402');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Website refresh');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 5,900.00');
  expect.soft((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const pdf = await page.request.get(`/api/documents/${id}/pdf`);
  expect(pdf.ok()).toBeTruthy(); expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByLabel('Amount received (Rs)').fill('2000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Rs 3,900.00 still due')).toBeVisible();
  const receiptHref = await page.getByRole('link', { name: 'Receipt', exact: true }).first().getAttribute('href');
  expect(receiptHref).toBeTruthy();
  const receipt = await page.request.get(receiptHref!);
  expect(receipt.ok()).toBeTruthy(); expect((await receipt.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByLabel('Amount received (Rs)').fill('3900');
  await page.getByLabel('Method', { exact: true }).selectOption('upi');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receipt', exact: true })).toHaveCount(2);
  expect.soft((await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  expect(faults).toEqual([]);
});

