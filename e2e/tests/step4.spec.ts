import { expect, test, type BrowserContext } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
// a 1 by 1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('expenses are recorded with a receipt, filtered, edited, exported and deleted', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/expenses');
  await expect(page.getByText('No expenses in this period.')).toBeVisible();

  await page.getByRole('button', { name: 'Add an expense' }).click();
  await page.getByLabel('Vendor').fill('City Cabs');
  await page.locator('#xc').fill('Travel');
  await page.getByLabel('Amount paid (Rs, with GST)').fill('1180');
  await page.getByLabel('GST in that amount (Rs)').fill('180');
  await page.getByLabel('Paid by').selectOption('upi');
  await page.getByLabel('Receipt (photo or PDF, optional)').setInputFiles({ name: 'cab.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense saved.')).toBeVisible();
  await expect(page.getByTestId('expense-total')).toHaveText('Rs 1,180.00');
  await expect(page.getByTestId('expense-gst')).toHaveText('Rs 180.00');
  const row = page.getByRole('row', { name: /City Cabs/ });
  await expect(row).toContainText('UPI');

  const receipt = await page.request.get(await row.getByRole('link', { name: 'Receipt' }).evaluate((a) => (a as HTMLAnchorElement).href));
  expect(receipt.status()).toBe(200);
  expect(receipt.headers()['content-type']).toBe('image/png');
  expect(receipt.headers()['x-content-type-options']).toBe('nosniff');

  await page.getByRole('button', { name: 'Add an expense' }).click();
  await page.getByLabel('Vendor').fill('Landlord');
  await page.locator('#xc').fill('Rent');
  await page.getByLabel('Amount paid (Rs, with GST)').fill('20000');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByTestId('expense-total')).toHaveText('Rs 21,180.00');

  await page.locator('#ec').selectOption('Rent');                                         // the filter
  await expect(page.getByTestId('expense-total')).toHaveText('Rs 20,000.00');
  await page.locator('#ec').selectOption('');

  await page.getByRole('row', { name: /Landlord/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Amount paid (Rs, with GST)').fill('22000');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByTestId('expense-total')).toHaveText('Rs 23,180.00');

  const csv = await page.request.get('/api/expenses?format=csv');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('City Cabs');

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('row', { name: /Landlord/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('expense-total')).toHaveText('Rs 1,180.00');

  // a file that only claims to be a picture is refused
  const bad = await page.request.put(`/api/expenses/${(await (await page.request.get('/api/expenses')).json()).rows[0].id}/receipt`, { data: { name: 'x.png', type: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') } });
  expect(bad.status()).toBe(400);
});

test('an overdue invoice offers a late fee debit note, which the owner issues', async ({ page, context }) => {
  test.setTimeout(120_000);
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Slow Payer', stateCode: '27' } })).json();
  const mk = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, docDate: addDays(istToday(), -50), dueDate: addDays(istToday(), -40),
    lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${mk.id}/issue`, { data: {} });

  // off by default: no panel
  await page.goto(`/app/invoices/${mk.id}`);
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await expect(page.getByTestId('late-fee')).toHaveCount(0);

  await page.goto('/app/settings');
  const form = page.getByRole('form', { name: 'Late fees' });
  await form.getByLabel('Offer late fees on overdue invoices').check();
  await form.getByLabel('Percent per month').fill('2');
  await form.getByLabel('Grace days after the due date').fill('7');
  await form.getByRole('button', { name: 'Save late fee settings' }).click();
  await expect(page.getByText('Late fee settings saved.')).toBeVisible();
  await form.getByLabel('Percent per month').fill('abc');
  await form.getByRole('button', { name: 'Save late fee settings' }).click();
  await expect(form.locator('p[role="alert"]')).toContainText('percentage a month');

  await page.goto(`/app/invoices/${mk.id}`);
  const panel = page.getByTestId('late-fee');
  await expect(panel).toContainText('33 days');
  await expect(page.getByTestId('late-fee-amount')).toHaveText('Rs 25.96');         // 2% a month of Rs 1,180 for 33 days
  await panel.getByRole('button', { name: 'Create late fee debit note' }).click();
  await expect(page.getByRole('heading', { name: /Debit note/ })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Issue' }).click();
  await expect(page.getByRole('heading', { name: /Debit note DN\// })).toBeVisible();

  await page.goto(`/app/invoices/${mk.id}`);
  await expect(page.getByTestId('late-fee')).toContainText('Already charged');
  await expect(page.getByTestId('late-fee')).toContainText('DN/');
  await expect(page.getByRole('button', { name: 'Create late fee debit note' })).toHaveCount(0);   // those days are charged
});

test('a quote in euros for a customer abroad shows euros everywhere and no rupee rounding', async ({ page, context }) => {
  test.setTimeout(120_000);
  await owner(context);
  await page.goto('/app/customers');
  await page.getByLabel('Name', { exact: true }).fill('Berlin GmbH');
  await page.getByLabel('State', { exact: true }).selectOption('96');
  await page.getByLabel('Usual quote currency').selectOption('EUR');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByRole('row', { name: /Berlin GmbH/ })).toContainText('Outside India');
  await expect(page.getByRole('row', { name: /Berlin GmbH/ })).toContainText('(EUR)');

  await page.goto('/app/invoices/new');
  await page.getByLabel('Document type').selectOption('estimate');
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Berlin GmbH' });
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');                         // picked up from the customer
  await page.getByLabel(/Exchange rate/).fill('90.5');
  await page.getByLabel('Line 1 description').fill('Design work');
  await page.getByLabel('Line 1 HSN or SAC').fill('998391');
  await page.getByLabel('Line 1 rate').fill('100.50');
  await page.getByLabel('Line 1 GST rate').selectOption('0');                            // an export of services is zero rated
  await expect(page.getByTestId('grand-total')).toHaveText('EUR 100.50');                // not rounded to 101
  await page.getByRole('button', { name: 'Issue estimate' }).click();
  await expect(page.getByRole('heading', { name: /Estimate EST/ })).toBeVisible();
  await expect(page.getByText(/EUR 100\.50 at 1 EUR = Rs 90\.5/)).toBeVisible();

  const id = page.url().split('/').pop()!.split('?')[0]!;
  const html = (await (await page.request.get(`/api/documents/${id}/html`)).json()).html as string;
  expect(html).toContain('Total (EUR)');
  expect(html).toContain('Exchange rate used: 1 EUR = Rs 90.5');
  expect(html).toContain('This is not a tax invoice');
  expect(html).not.toMatch(/rupees only/i);

  await page.goto('/app/invoices');
  await expect(page.getByRole('row', { name: /EST\// })).toContainText('EUR 100.50');

  // a tax invoice cannot be made in euros
  const r = await page.request.post('/api/documents', { data: { docType: 'tax_invoice', currency: 'EUR', exchangeRate: '90', lines: [{ name: 'X', hsnSac: '998391', quantity: '1', rate: '1', taxRateBp: 1800 }] } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toContain('always in rupees');
});
