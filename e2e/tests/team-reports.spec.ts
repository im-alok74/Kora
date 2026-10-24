import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { db, fillInvoice, gstin, makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}
async function sessionFor(context: BrowserContext, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${userId}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  await context.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

test('an owner adds an accountant, who can read and export but not change anything', async ({ page, context, browser }) => {
  const o = await owner(context);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: '=HYPERLINK("http://evil.example")', rate: '1000' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();

  await page.goto('/app/team');
  await page.getByLabel('Mobile number or email').fill('98765 11111');
  await page.getByLabel('Role').first().selectOption('accountant');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Ask them to sign in at Kora with 98765 11111.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /\+919876511111/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Role of +919876511111' })).toHaveValue('accountant');

  // the invitee signs in (their own session) and sees the business
  const [inv] = await db`select id from app_user where phone = '+919876511111'`;
  const ctx2 = await browser.newContext();
  await sessionFor(ctx2, inv!.id as string);
  const p2 = await ctx2.newPage();
  await p2.goto('/app/invoices');
  await expect(p2.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await expect(p2.getByRole('link', { name: 'New invoice' })).toHaveCount(0);
  await expect(p2.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await expect(p2.getByRole('link', { name: 'Reports' })).toBeVisible();
  await expect(p2.getByRole('link', { name: 'Activity' })).toBeVisible();
  await p2.getByRole('link', { name: /INV\// }).first().click();
  await expect(p2.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
  await expect(p2.getByRole('button', { name: 'Cancel this invoice' })).toHaveCount(0);

  // export works, and the formula in the customer name is defused
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const csv = await p2.request.get(`/api/reports/sales?from=${month.slice(0, 8)}01&to=${month}&format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
  expect(text).not.toMatch(/,=HYPERLINK/);
  expect(text).toContain('1180.00');
  expect((await p2.request.post('/api/team', { data: { identifier: '9000000009', role: 'owner' } })).status()).toBe(403);
  await ctx2.close();

  // the owner changes the role, then removes the person
  await page.reload();
  await page.getByRole('combobox', { name: 'Role of +919876511111' }).selectOption('staff');
  await expect(page.getByRole('combobox', { name: 'Role of +919876511111' })).toHaveValue('staff');
  await page.getByRole('row', { name: /919876511111/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('cell', { name: /\+919876511111/ })).toHaveCount(0);
  void o;
});

test('the last owner cannot be demoted or removed', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/team');
  await page.getByRole('combobox', { name: /Role of/ }).first().selectOption('staff');
  await expect(page.locator('p[role="alert"]')).toContainText('at least one owner');
});

test('reports: the register, who owes you, a customer statement and GST summary add up', async ({ page, context }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Verma Stores', stateCode: '27' } })).json();
  const mk = async (rate: string, due: string) => {
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, dueDate: due, lines: [{ name: 'Item', hsnSac: '847130', quantity: '1', rate, taxRateBp: 1800 }] } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  };
  const id1 = await mk('1000', '2020-01-01');
  await mk('2000', '2099-01-01');
  await page.request.post(`/api/documents/${id1}/payments`, { data: { amount: '300', method: 'upi' } });

  await page.goto('/app/reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Verma Stores' }).first()).toBeVisible();
  await expect(page.getByText('2 documents')).toBeVisible();
  await page.getByRole('tab', { name: 'Who owes you' }).click();
  await expect(page.getByRole('row', { name: /Verma Stores/ })).toContainText('Rs 2,360.00');   // not due
  await expect(page.getByRole('row', { name: /Verma Stores/ })).toContainText('Rs 880.00');     // over 90 days: 1,180 less 300
  await page.getByRole('tab', { name: 'Customer statement' }).click();
  await expect(page.getByText('Closing balance')).toBeVisible();
  await page.getByRole('tab', { name: 'GST summary' }).click();
  await expect(page.getByText('Total tax')).toBeVisible();
  await page.getByRole('tab', { name: 'GSTR-1 data' }).click();
  await expect(page.getByText('The sections add up to your sales ledger exactly.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download GSTR-1 JSON' })).toBeVisible();
  const ageing = await page.request.get('/api/reports/ageing?format=csv');
  expect(ageing.headers()['content-disposition']).toContain('ageing_');
});

test('the activity log shows what happened and who did it', async ({ page, context }) => {
  const o = await owner(context);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Logged Co', stateCode: '27' } });
  await page.goto('/app/activity');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Customer created/ }).first()).toContainText(o.email);
  await page.getByRole('button', { name: 'Details' }).first().click();
  await expect(page.locator('pre').first()).toBeVisible();
});

test('one login can run several businesses and switch between them', async ({ page, context }) => {
  const o = await owner(context);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Only In First', stateCode: '27' } });
  const second = await (await page.request.post('/api/businesses', { data: { legalName: 'Second Co', registrationType: 'regular', gstin: gstin('29'), stateCode: '29' } })).json();
  expect(second.businessId).toBeTruthy();
  await page.goto('/app/customers');
  await expect(page.getByRole('cell', { name: 'Only In First' })).toBeVisible();
  await page.getByLabel('Business').selectOption({ label: 'Second Co' });
  await expect(page).toHaveURL(/\/app\/invoices$/);
  await page.goto('/app/customers');
  await expect(page.getByRole('cell', { name: 'Only In First' })).toHaveCount(0);
  await page.getByLabel('Business').selectOption({ label: 'Acme Traders' });
  await expect(page).toHaveURL(/\/app\/invoices$/);
  await page.goto('/app/customers');
  await expect(page.getByRole('cell', { name: 'Only In First' })).toBeVisible();
  void o;
});
