import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db, gstin, makeEinvoiceBusiness, signedIn } from '../helpers';

async function setup(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeEinvoiceBusiness(u.userId);
  return { ...u, ...b };
}

/** Creates a B2B customer and an issued invoice by API, then opens it. */
async function invoiceFor(page: Page, o: { gstin?: string; address?: boolean; name?: string } = {}) {
  const party = await (await page.request.post('/api/parties', { data: {
    kind: 'customer', name: o.name ?? 'Buyer Co', gstin: o.gstin ?? gstin('29'),
    billingAddress: o.address === false ? {} : { line1: '5 Brigade Road', city: 'Bengaluru', pincode: '560001' } } })).json();
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id,
    lines: [{ name: 'Laptop', hsnSac: '847130', quantity: '2', rate: '10000', taxRateBp: 1800 }] } })).json();
  const issued = await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  expect(issued.ok()).toBeTruthy();
  await page.goto(`/app/invoices/${d.id}`);
  return d.id as string;
}

test('an invoice to a registered business is registered with the portal and carries the IRN and QR', async ({ page, context, browser }) => {
  await setup(context);
  const id = await invoiceFor(page);
  await expect(page.getByTestId('einvoice').getByText('Registered.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('einvoice')).toContainText(/IRN [0-9a-f]{64}/);
  const share = await (await page.request.post(`/api/documents/${id}/share`, { data: {} })).json();
  const anon = await browser.newContext();
  const html = await (await anon.request.get(share.url)).text();
  expect(html).toMatch(/IRN<\/b> [0-9a-f]{64}/);
  expect(html).toContain('alt="e-invoice QR"');
  const pdf = await anon.request.get(share.url + '/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await anon.close();
});

test('a sale to someone without a GSTIN is not e-invoiced', async ({ page, context }) => {
  await setup(context);
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', lines: [{ name: 'Counter sale', hsnSac: '847130', quantity: '1', rate: '500', taxRateBp: 1800 }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.goto(`/app/invoices/${d.id}`);
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await expect(page.getByTestId('einvoice')).toHaveCount(0);
});

test('a rejection is explained in plain words, fixed on the same screen, and resubmitted', async ({ page, context }) => {
  await setup(context);
  await invoiceFor(page, { gstin: gstin('29', 'REJEC'), name: 'Dormant Traders' });
  const panel = page.getByTestId('einvoice');
  await expect(panel.getByText('Not registered.')).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText("The buyer's GSTIN is not active on the GST portal.");
  await expect(panel).toContainText('Ask the customer for their current GSTIN');
  await panel.getByLabel('Buyer GSTIN').fill(gstin('27'));
  await panel.getByRole('button', { name: 'Resubmit e-invoice' }).click();
  await expect(page.locator('p[role="alert"]').first()).toContainText('must be from Karnataka');
  await panel.getByLabel('Buyer GSTIN').fill(gstin('29', 'FIXED'));
  await panel.getByRole('button', { name: 'Resubmit e-invoice' }).click();
  await expect(panel.getByText('Registered.')).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText('1 earlier attempt');
});

test('missing buyer details are caught before anything is sent, and fixed in place', async ({ page, context }) => {
  await setup(context);
  const id = await invoiceFor(page, { address: false, name: 'No Address Co' });
  const panel = page.getByTestId('einvoice');
  await expect(panel.getByText('Not registered.')).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText('The buyer needs an address.');
  await expect(panel).toContainText('Add address line 1 in the customer details on this invoice.');
  await panel.getByLabel('Address line 1').fill('5 Brigade Road');
  await panel.getByLabel('City').fill('Bengaluru');
  await panel.getByLabel('Pincode').fill('560001');
  await panel.getByRole('button', { name: 'Resubmit e-invoice' }).click();
  await expect(panel.getByText('Registered.')).toBeVisible({ timeout: 60_000 });
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.document.recipient_snapshot.billing_address.pincode).toBe('560001');
});

test('a portal outage shows that it is retrying, then succeeds on its own', async ({ page, context }) => {
  test.setTimeout(150_000);
  await setup(context);
  const id = await invoiceFor(page, { gstin: gstin('29', 'OUTAG'), name: 'Flaky Buyer' });
  const panel = page.getByTestId('einvoice');
  await expect(panel).toContainText('Trying again automatically', { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await db`update job set run_at = now() where payload->>'documentId' = ${id} and status = 'queued'`;
    await page.waitForTimeout(3000);
  }
  await expect(panel.getByText('Registered.')).toBeVisible({ timeout: 60_000 });
});

test('the e-invoice and the invoice can be cancelled within the window', async ({ page, context }) => {
  await setup(context);
  await invoiceFor(page);
  const panel = page.getByTestId('einvoice');
  await expect(panel.getByText('Registered.')).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('button', { name: 'Cancel e-invoice' }).click();
  await panel.getByLabel('Remark').fill('Wrong quantity');
  await panel.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('E-invoice and invoice cancelled.')).toBeVisible();
  await expect(page.getByText('Cancelled: E-invoice cancelled: Data entry mistake. Wrong quantity')).toBeVisible();
});

test('GSTR-1 data and the GST summary come out of the invoices', async ({ page, context }) => {
  await setup(context);
  const g = gstin('29');
  await invoiceFor(page, { gstin: g, name: 'Report Buyer' });
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const r = await (await page.request.get(`/api/reports/gstr1?period=${month}`)).json();
  expect(r.json.b2b[0].ctin).toBe(g);
  expect(r.json.b2b[0].inv[0]).toMatchObject({ val: 23600, pos: '29' });
  expect(r.reconciliation.matches).toBe(true);
  const file = await page.request.get(`/api/reports/gstr1?period=${month}&download=1`);
  expect(file.headers()['content-disposition']).toContain(`GSTR1_${month}.json`);
  expect((await file.json()).gstin).toMatch(/^27/);
  const s = await (await page.request.get(`/api/reports/gst-summary?period=${month}`)).json();
  expect(BigInt(s.outwardTaxable.igst)).toBe(360000n);
  expect((await page.request.get('/api/reports/gstr1?period=nope')).status()).toBe(400);
});
