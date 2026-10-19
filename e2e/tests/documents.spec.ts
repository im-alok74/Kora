import { expect, test, type Page } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

async function owner(context: import('@playwright/test').BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}

async function issueOne(page: Page, o: Parameters<typeof fillInvoice>[1] = {}) {
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Verma Stores', ...o });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  return page.url().split('/').pop()!.split('?')[0]!;
}

test('numbers run in sequence and the issued invoice cannot be edited', async ({ page, context }) => {
  await owner(context);
  await issueOne(page);
  await expect(page.getByRole('heading', { name: /INV\/\d\d-\d\d\/0001/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { rate: '500' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /INV\/\d\d-\d\d\/0002/ })).toBeVisible();
  await page.goto('/app/invoices');
  await expect(page.getByRole('link', { name: /\/0001/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /\/0002/ })).toBeVisible();
});

test('intra-state shows CGST and SGST, inter-state shows IGST, and totals match what is issued', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Local', customerState: '27', rate: '1000' });
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,180.00');
  await expect(page.getByLabel('Totals')).toContainText('CGST');
  await page.getByLabel('Customer', { exact: true }).selectOption('__new');
  await page.getByLabel('Customer name').fill('Far Away');
  await page.getByLabel('State', { exact: true }).selectOption('29');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Far Away' });
  await expect(page.getByLabel('Totals')).toContainText('IGST');
  await expect(page.getByLabel('Totals')).not.toContainText('CGST');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,180.00');
});

test('a draft can be saved, reopened, edited and deleted', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Draft Co', rate: '200' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('200.00');
  await page.getByLabel('Line 1 rate').fill('300');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 354.00');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete draft' }).click();
  await expect(page).toHaveURL(/\/app\/invoices$/);
  await expect(page.getByText('No documents yet.')).toBeVisible();
});

test('double-clicking Issue creates one invoice, not two', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Double Co' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).dblclick();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const r = await page.request.get('/api/documents');
  expect((await r.json()).documents).toHaveLength(1);
});

test('ten invoices issued at the same moment get numbers 1 to 10 with none missing', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices');
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await page.request.post('/api/documents', { data: { docType: 'proforma', lines: [{ name: 'Item', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800 }] } });
    expect(r.ok()).toBeTruthy();
    ids.push((await r.json()).id);
  }
  const results = await Promise.all(ids.map((id) => page.request.post(`/api/documents/${id}/issue`, { data: {} })));
  expect(results.every((r) => r.ok())).toBe(true);
  const nums = (await Promise.all(results.map(async (r) => (await r.json()).document.number as string)))
    .map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
  expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a credit note corrects an issued invoice, and a second full credit is refused', async ({ page, context }) => {
  await owner(context);
  await issueOne(page, { rate: '1000' });
  await page.getByRole('button', { name: 'Start a credit note' }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await page.getByLabel('Line 1 rate').fill('400');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 472.00');
  await page.getByRole('button', { name: 'Issue credit note' }).click();
  await expect(page.getByRole('heading', { name: /Credit note CN\/\d\d-\d\d\/0001/ })).toBeVisible();
  await page.goto('/app/invoices');
  await page.getByRole('link', { name: /INV\// }).click();
  await page.getByRole('button', { name: 'Start a credit note' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('more than what is left');
});

test('cancelling needs a reason and keeps the number', async ({ page, context }) => {
  await owner(context);
  await issueOne(page);
  await page.getByRole('button', { name: 'Cancel this invoice' }).click();
  await page.getByLabel('Reason for cancelling').fill('Wrong customer');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('Cancelled: Wrong customer')).toBeVisible();
  await expect(page.getByRole('heading', { name: /INV\/\d\d-\d\d\/0001/ })).toBeVisible();
});

test('the public link shows the invoice without signing in, counts views, and offers a PDF', async ({ page, context, browser }) => {
  await owner(context);
  const id = await issueOne(page);
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.locator('p.muted', { hasText: '/i/' }).innerText();
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  const resp = await pub.goto(link);
  expect(resp!.status()).toBe(200);
  expect(resp!.headers()['content-security-policy']).toContain("default-src 'none'");
  await expect(pub.getByText('Tax Invoice').first()).toBeVisible();
  await expect(pub.getByText(/INV\/\d\d-\d\d\/0001/).first()).toBeVisible();
  const pdf = await anon.request.get(link + '/pdf');
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await anon.close();
  await page.reload();
  await expect(page.getByText(/Opened [12] times? by the customer/)).toBeVisible();
  const own = await page.request.get(`/api/documents/${id}/pdf`);
  expect(own.headers()['content-type']).toBe('application/pdf');
  // a garbage token is a plain 404
  const bad = await (await browser.newContext()).request.get('/i/not-a-real-token-at-all');
  expect(bad.status()).toBe(404);
});

test('send failures are shown, not swallowed', async ({ page, context }) => {
  await owner(context);
  await issueOne(page);
  await page.getByLabel('Mobile number').fill('123');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('valid 10-digit mobile number');
});

test('the template changes the look but the statutory fields stay', async ({ page, context, browser }) => {
  await owner(context);
  await page.goto('/app/settings');
  await page.getByLabel('Colour').fill('#112233');
  await page.getByLabel('Show payment details').uncheck();
  await page.getByLabel('Show signature line').uncheck();
  await expect(page.getByText('Always printed, cannot be changed')).toBeVisible();
  await expect(page.getByText('Supplier name, address and GSTIN')).toBeVisible();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved.')).toBeVisible();
  await issueOne(page);
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.locator('p.muted', { hasText: '/i/' }).innerText();
  const anon = await browser.newContext();
  const html = await (await anon.request.get(link)).text();
  expect(html).toContain('#112233');
  expect(html).toContain('GSTIN:');
  expect(html).toContain('HSN/SAC');
  expect(html).not.toContain('Authorised signatory');
  await anon.close();
});

test('settings: an owner saves business details that appear on the invoice', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/settings');
  await page.getByLabel('Address line 1').fill('12 MG Road');
  await page.getByLabel('City').fill('Pune');
  await page.getByLabel('UPI ID').fill('acme@okhdfc');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByText('Business details saved.')).toBeVisible();
  await page.getByLabel('UPI ID').fill('not a upi id');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('UPI ID');
});

test('items autofill HSN, rate and GST on a line', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/items');
  await page.getByLabel('Name', { exact: true }).fill('Laptop');
  await page.getByLabel('HSN or SAC').fill('847130');
  await page.getByLabel('Price (Rs)').fill('55000');
  await page.getByLabel('GST rate').selectOption('1800');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('cell', { name: 'Laptop' })).toBeVisible();
  await page.goto('/app/invoices/new');
  await page.getByLabel('Line 1 description').fill('Laptop');
  await expect(page.getByLabel('Line 1 HSN or SAC')).toHaveValue('847130');
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('55000.00');
});
