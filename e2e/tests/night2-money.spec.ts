import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { db, makeBusiness, signedIn } from '../helpers';
import { SECRET } from '../playwright.config';

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
  await expect(page.locator('p.error')).toContainText('micro, small or medium');
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

test('tax held back on a vendor payment settles the bill and shows in the TDS payable report', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Buyer Co');
  const v = await (await page.request.post('/api/parties', { data: { kind: 'vendor', name: 'Fixit Contractors', stateCode: '27' } })).json();
  const bill = await (await page.request.post('/api/purchases', { data: { partyId: v.id, billNumber: 'FX-1', billDate: ist(-3), lines: [{ description: 'Repairs', quantity: '1', rate: '10000', taxRateBp: 0 }] } })).json();

  await page.goto(`/app/purchases/${bill.id}`);
  await page.getByLabel('Amount paid (Rs)').fill('9800');
  await page.getByLabel('Tax held back (TDS), if any (Rs)').fill('200');
  await page.getByLabel('TDS section').selectOption('194C');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await expect(page.getByText('TDS under 194C')).toBeVisible();

  await page.goto('/app/reports');
  await page.getByRole('tab', { name: 'TDS payable' }).or(page.getByRole('button', { name: 'TDS payable' })).first().click();
  await expect(page.getByRole('table', { name: 'TDS payable by vendor' })).toContainText('Fixit Contractors');
  await expect(page.getByRole('table', { name: 'TDS payable by vendor' })).toContainText('Rs 200.00');
});

test('a customer gets their own reminder schedule, with a preview and the plan for open invoices', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Remind Co');
  await page.request.put('/api/reminders', { data: { enabled: true, channel: 'whatsapp', offsets: [-2, 3, 7] } });
  const c = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Slow Payer Ltd', stateCode: '27', phone: '9876543210' } })).json();
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: c.id, dueDate: ist(30), lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });

  await page.goto(`/app/customers/${c.id}`);
  await page.getByRole('tab', { name: 'Reminders' }).click();
  await expect(page.getByTestId('reminder-preview')).toContainText('Reminder:');
  await expect(page.getByTestId('reminder-preview')).toContainText('2 days before the due date');
  await expect(page.getByRole('table', { name: 'Reminders waiting' }).locator('tbody tr')).toHaveCount(3);

  await page.getByLabel('Use a schedule just for this customer').check();
  await page.getByLabel('Days before the due date').fill('5');
  await page.getByLabel('Days after the due date').fill('3, 10');
  await page.getByLabel('Also remind on the due date').check();
  await page.getByLabel('Send by').selectOption('sms');
  await page.getByRole('button', { name: 'Preview this schedule' }).click();
  await expect(page.getByTestId('reminder-preview')).toContainText('On the due date');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Schedule saved for this customer.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Reminders waiting' }).locator('tbody tr')).toHaveCount(4);
  await expect(page.getByText('No reminders have gone out to this customer yet.')).toBeVisible();

  // paying the invoice stops the reminders
  await page.request.post(`/api/documents/${d.id}/payments`, { data: { amount: '1180', method: 'cash' } });
  await page.reload();
  await page.getByRole('tab', { name: 'Reminders' }).click();
  await expect(page.getByText('No reminders are waiting.')).toBeVisible();
});

async function recoverPortalCode(linkId: string): Promise<string> {
  const [c] = await db`select code_hash from portal_code where portal_link_id = ${linkId} and consumed_at is null order by created_at desc limit 1`;
  const want = Buffer.from(c!.code_hash);
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, '0');
    if (createHmac('sha256', SECRET).update(`portal:${linkId}:${code}`).digest().equals(want)) return code;
  }
  throw new Error('code not found');
}

test('a customer signs in to the portal with a code, pays two invoices together, comments, attaches a PO and gets a statement PDF', async ({ page, context, browser }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Portal Co');
  const c = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Asha Stores', stateCode: '27', email: 'asha@stores.test' } })).json();
  const mk = async (docType: string, rate: string) => {
    const d = await (await page.request.post('/api/documents', { data: { docType, partyId: c.id, dueDate: ist(10), lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  };
  await mk('tax_invoice', '1000'); await mk('tax_invoice', '500'); await mk('estimate', '5000');
  const link = await (await page.request.post(`/api/parties/${c.id}/portal`, { data: {} })).json();
  expect((await page.request.put(`/api/parties/${c.id}/portal/settings`, { data: { codeLogin: true } })).ok()).toBe(true);
  const [row] = await db`select id from portal_link where party_id = ${c.id} and revoked_at is null`;

  // the customer arrives with no account of ours, only the link
  const cust = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const p = await cust.newPage();
  await p.goto(`/portal/${link.token}`);
  await expect(p.getByRole('heading', { name: 'Open your account' })).toBeVisible();
  await p.getByRole('button', { name: /Email a code to as\*\*@stores.test/ }).click();
  await expect(p.getByText('We sent a 6 digit code to')).toBeVisible();
  await p.getByLabel('Code').fill('000000');
  await p.getByRole('button', { name: 'Open my account' }).click();
  await expect(p.locator('p.error')).toContainText('not right or has expired');
  await p.getByLabel('Code').fill(await recoverPortalCode(row!.id as string));
  await p.getByRole('button', { name: 'Open my account' }).click();
  await expect(p.getByTestId('portal-owing')).toHaveText('Rs 1,500.00');

  // two invoices together
  const boxes = p.getByRole('checkbox', { name: /to pay together/ });
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await expect(p.getByText('2 invoices chosen, Rs 1,500.00 in all.')).toBeVisible();
  await p.getByRole('button', { name: 'Pay Rs 1,500.00 together' }).click();
  await expect(p).toHaveURL(/mock-gateway/);

  // a comment and a purchase order on the estimate
  await p.goto(`/portal/${link.token}`);
  await p.getByText(/^Estimate /).first().click();
  await p.getByLabel(/Write a comment on/).fill('Please confirm the delivery date.');
  await p.getByRole('button', { name: 'Send comment' }).click();
  await expect(p.getByText('Your comment has been sent.')).toBeVisible();
  await p.getByLabel(/Attach your purchase order/).setInputFiles({ name: 'PO-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 purchase order') });
  await expect(p.getByText('Your purchase order has been attached.')).toBeVisible();
  const pdf = await p.request.get(`/api/portal/${link.token}/statement?format=pdf`);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  // a stranger with the link but no session sees nothing
  const stranger = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await stranger.request.get(`/api/portal/${link.token}`)).status()).toBe(401);
  await cust.close(); await stranger.close();

  // the business sees what the customer wrote and sent
  await page.goto(`/app/customers/${c.id}`);
  await page.getByRole('tab', { name: 'Portal' }).click();
  await expect(page.getByText('Please confirm the delivery date.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'PO-1.pdf' })).toBeVisible();
});

test('the invoice shows the money story and a part refund reopens part of it', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Refund Co');
  const c = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Refund Buyer', stateCode: '27' } })).json();
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: c.id, dueDate: ist(10), lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.request.post(`/api/documents/${d.id}/payments`, { data: { amount: '1000', method: 'bank_transfer' } });

  await page.goto(`/app/invoices/${d.id}`);
  const tl = page.getByTestId('payment-timeline');
  await expect(tl).toContainText('Paid in full');
  await expect(tl).toContainText('Payment received');
  await tl.getByRole('button', { name: 'Refund some or all of this' }).click();
  await tl.getByLabel('Refund (Rs)').fill('250');
  await tl.getByLabel('Note').fill('Goods returned');
  await tl.getByRole('button', { name: 'Refund', exact: true }).click();
  await expect(tl).toContainText('Part paid');
  await expect(tl).toContainText('Rs 250.00 of Rs 1,000.00 is still owed.');
  await expect(tl).toContainText('Goods returned');
});

test('a customer page keeps tags, a credit limit and notes, and duplicates can be merged', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Tidy Co');
  const a = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Sharma Traders Pvt Ltd', stateCode: '27', phone: '9811111111' } })).json();
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Sharma Traders', stateCode: '27', phone: '9811111111' } });
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: a.id, dueDate: ist(10), lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '1500', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });

  await page.goto(`/app/customers/${a.id}`);
  await page.getByRole('tab', { name: 'Notes and limits' }).click();
  await page.getByLabel('Tags (separate with commas)').fill('wholesale, slow-payer');
  await page.getByLabel('Credit limit (Rs)').fill('1000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByTestId('over-limit')).toContainText('Over the credit limit by Rs 500.00');
  await page.getByLabel('Add a note').fill('Pays on the 10th.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Pays on the 10th.')).toBeVisible();

  await page.goto('/app/customers');
  await page.getByText('Export, import and tidy up').click();
  const csv = await page.request.get('/api/parties/export?format=csv');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('slow-payer');
  const xlsx = await page.request.get('/api/parties/export?format=xlsx');
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  await page.getByRole('button', { name: 'Find duplicates' }).click();
  await expect(page.getByText('Same mobile number and same name')).toBeVisible();
  page.once('dialog', (x) => void x.accept());
  await page.getByRole('button', { name: 'Keep this one' }).first().click();
  await expect(page.getByText('Merged.')).toBeVisible();
  await expect(page.getByText('No duplicates found.')).toBeVisible();
});

test('expenses: mileage is worked out, and billable expenses become a draft invoice', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Spend Co');
  const c = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Rebill Buyer', stateCode: '27' } })).json();
  await page.goto('/app/expenses');
  await page.getByLabel('Distance (km)').fill('100');
  await page.getByLabel('Rate per km (Rs)').fill('12');
  await page.getByLabel('Bill to a customer (optional)').selectOption({ label: 'Rebill Buyer' });
  await page.getByRole('button', { name: 'Save mileage' }).click();
  await expect(page.getByText('Mileage saved as an expense.')).toBeVisible();
  const bill = await (await page.request.get('/api/expenses/billable')).json();
  expect(bill.expenses).toHaveLength(1);
  expect(bill.expenses[0].amount_paise).toBe('120000');
  await page.reload();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /Make a draft invoice/ }).click();
  await expect(page).toHaveURL(/\/app\/invoices\//);
  await expect(page.locator('input[value^="Reimbursement: Mileage"]').first()).toBeVisible();
  void c;
});

test('reports: sales by month and profit and loss, with Excel and saved views; dashboard shows the week and top customers', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Report Co');
  const c = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Top Buyer', stateCode: '27' } })).json();
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: c.id, dueDate: ist(3), lines: [{ name: 'Design', hsnSac: '998313', quantity: '2', rate: '1000', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.request.post('/api/expenses', { data: { category: 'Rent', amount: '500' } });

  await page.goto('/app/reports');
  await page.getByRole('tab', { name: 'Sales by item' }).click();
  await expect(page.getByRole('table', { name: 'Sales by item' })).toContainText('Design');
  await page.getByRole('tab', { name: 'Profit and loss' }).click();
  await expect(page.getByTestId('pnl-net')).toHaveText('Rs 1,500.00');
  await page.getByLabel('Save this view as').fill('My P&L');
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.reload();
  await page.locator('#rv').selectOption('My P&L');
  await expect(page.getByTestId('pnl-net')).toHaveText('Rs 1,500.00');
  const x = await page.request.get(`/api/reports/months?format=xlsx`);
  expect(x.headers()['content-type']).toContain('spreadsheetml');
  expect((await x.body()).subarray(0, 2).toString()).toBe('PK');

  await page.goto('/app');
  await expect(page.getByTestId('stat-week')).toHaveText('Rs 2,000.00');
  await expect(page.getByTestId('top-customers')).toContainText('Top Buyer');
});
