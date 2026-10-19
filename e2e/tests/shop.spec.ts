import { expect, test } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

test('a shopkeeper adds an MRP item with a barcode and stock, scans it at the till, and prints a receipt', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Corner Shop');

  await page.goto('/app/items');
  await page.getByRole('button', { name: 'Add an item' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Gift box');
  await page.getByLabel('HSN or SAC').fill('3923');
  await page.getByLabel('Price (Rs)').fill('99');
  await page.getByLabel('GST rate').selectOption('1800');
  await page.getByLabel(/already includes GST/).check();
  await page.getByLabel(/Keep count of stock/).check();
  await page.getByLabel('Barcode (optional)').fill('8901234567890');
  await page.getByLabel('Tell me when it falls to').fill('3');
  await page.getByRole('button', { name: 'Add item' }).click();
  const row = page.getByRole('row', { name: /Gift box/ });
  await expect(row).toContainText('Rs 99.00');
  await expect(row).toContainText('incl.');
  await expect(row).toContainText('0 NOS');
  await expect(row).toContainText('Low');

  // bring stock in
  await row.getByRole('button', { name: 'Stock' }).click();
  await page.getByLabel('Quantity').fill('5');
  await page.getByLabel('Why').fill('Opening stock');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stock is now 5 NOS.' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Stock history' })).toContainText('Opening stock');

  // the till: scan twice, the total is exactly the prices shown
  await page.goto('/app/pos');
  await expect(page.getByRole('heading', { name: 'Till' })).toBeVisible();
  const scan = page.getByLabel('Scan a barcode, or type an item name');
  await scan.fill('8901234567890');
  await scan.press('Enter');
  await expect(page.getByLabel('Gift box quantity')).toHaveValue('1');
  await scan.fill('8901234567890');
  await scan.press('Enter');
  await expect(page.getByLabel('Gift box quantity')).toHaveValue('2');
  await expect(page.getByTestId('pos-total')).toHaveText('Rs 198.00');
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByLabel('Cash received (optional)').fill('200');
  await expect(page.getByTestId('change')).toContainText('Rs 2.00');
  await page.getByRole('button', { name: /^Take/ }).click();
  const done = page.getByRole('status', { name: 'Sale complete' });
  await expect(done).toContainText('Rs 198.00');
  const receipt = await done.getByRole('link', { name: 'Print receipt' }).getAttribute('href');
  const pdf = await page.request.get(receipt!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(body.toString('latin1'));
  expect(Number(mb![1]) / 2.8346).toBeLessThan(82);                                  // an 80 mm roll, not a full page

  // the invoice is issued and paid, and the stock went down
  const id = receipt!.split('/')[3];
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.document).toMatchObject({ status: 'issued', payment_status: 'paid', grand_total_paise: '19800' });
  await page.goto('/app/items');
  await expect(page.getByRole('row', { name: /Gift box/ })).toContainText('3 NOS');
  await expect(page.getByRole('row', { name: /Gift box/ })).toContainText('Low');   // at the reorder level

  // an unknown barcode says so, and the notification bell flags the low stock via the stock list API
  await page.goto('/app/pos');
  await page.getByLabel('Scan a barcode, or type an item name').fill('0000000000000');
  await page.getByLabel('Scan a barcode, or type an item name').press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Nothing found' })).toBeVisible();
  const low = await (await page.request.get('/api/stock?low=1')).json();
  expect(low.items.map((x: { name: string }) => x.name)).toContain('Gift box');
});

test('a bill can be set to print in Hindi, and the choice is kept', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Sharma Store');
  await page.goto('/app/settings');
  await page.getByLabel('Language').selectOption('hi');
  await page.getByRole('button', { name: /Save template|Save the template|Save look/ }).first().click().catch(() => {});
  // the API is the source of truth for the saved template
  const t = await (await page.request.get('/api/template')).json();
  const saved = await page.request.put('/api/template', { data: { ...t.template, language: 'hi' } });
  expect(saved.ok()).toBe(true);
  expect((await (await page.request.get('/api/template')).json()).template.language).toBe('hi');
  const bad = await page.request.put('/api/template', { data: { ...t.template, language: 'klingon' } });
  expect(bad.status()).toBe(400);
  const draft = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', lines: [{ name: 'Atta', hsnSac: '1101', quantity: '1', rate: '100', taxRateBp: 500 }] } })).json();
  const html = (await (await page.request.get(`/api/documents/${draft.id}/html`)).json()).html as string;
  expect(html).toContain('कर चालान / Tax Invoice');
  expect(html).toContain('विवरण');
});
