import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { addUser, db, fillInvoice, makeBusiness, signedIn } from '../helpers';

async function sessionFor(context: BrowserContext, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${userId}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  await context.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

test('a CA with two clients sees both on one screen, with what is overdue, and can open one', async ({ page, context }) => {
  const u = await signedIn(context);
  const a = await makeBusiness(u.userId, 'Zulu Foods');
  const b = await makeBusiness(u.userId, 'Alpha Textiles');
  // no GST dates for the second one, so only an overdue invoice can make a client need attention, whatever day this runs
  await db`update business set registration_type = 'unregistered', gstin = null where id = ${b.businessId}`;
  // an overdue invoice in Zulu Foods: issue one, then move its due date into the past directly (the database allows this for the setup only)
  await page.request.post('/api/business/select', { data: { businessId: a.businessId } });
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Late Payer', rate: '1000' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await db`alter table document disable trigger user`;
  await db`update document set due_date = current_date - 10 where business_id = ${a.businessId}`;
  await db`alter table document enable trigger user`;

  await page.goto('/app/firm');
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await expect(page.getByTestId('firm-clients')).toHaveText('2');
  await expect(page.getByTestId('firm-attention')).toHaveText('1');
  await expect(page.getByTestId('firm-overdue')).toContainText('1,180.00');
  const rows = page.getByRole('table', { name: 'Clients' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('Zulu Foods');   // the one needing attention comes first, ahead of the alphabet
  await expect(rows.nth(2)).toContainText('Alpha Textiles');
  await expect(page.getByText(/GSTR-3B for/).first()).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search' }).fill('alpha');
  await expect(page.getByRole('table', { name: 'Clients' }).getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Open Alpha Textiles' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByLabel('Business')).toHaveValue(b.businessId);
});

test('the Clients link only shows for someone with more than one business', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Only Co');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clients' })).toHaveCount(0);
  await makeBusiness(u.userId, 'Second Co');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible();
});

test('a business sends a bill, and the accountant marks one done and sends another back', async ({ page, context, browser }) => {
  const u = await signedIn(context);
  const biz = await makeBusiness(u.userId, 'Acme Traders');
  const caId = await addUser(biz.businessId, 'accountant');
  const pdf = Buffer.from('%PDF-1.4 e2e bill');

  await page.goto('/app/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  for (const [title, name] of [['September rent', 'rent.pdf'], ['Blurry fuel slip', 'fuel.pdf']]) {
    await page.getByLabel('What is it?').fill(title!);
    await page.getByLabel('Photo or PDF').setInputFiles({ name: name!, mimeType: 'application/pdf', buffer: pdf });
    await page.getByLabel('Note for your accountant (optional)').fill('Paid in cash');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sent to your accountant.' })).toBeVisible();
    await expect(page.getByRole('article', { name: title! })).toBeVisible();
  }
  // a file that is not what it says is refused
  await page.getByLabel('What is it?').fill('Fake');
  await page.getByLabel('Photo or PDF').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>nope') });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'real file' })).toBeVisible();
  // the owner cannot review as staff would not; an owner can, but here we use the accountant

  const ctx2 = await browser.newContext();
  await sessionFor(ctx2, caId);
  const p2 = await ctx2.newPage();
  await p2.goto('/app/inbox');
  await expect(p2.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(p2.getByLabel('What is it?')).toHaveCount(0);   // an accountant does not send
  const rent = p2.getByRole('article', { name: 'September rent' });
  await expect(rent).toBeVisible();
  const file = await p2.request.get((await rent.getByRole('link', { name: 'rent.pdf' }).getAttribute('href'))!);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  expect(await file.text()).toBe('%PDF-1.4 e2e bill');
  await rent.getByRole('button', { name: 'Mark done' }).click();
  await expect(p2.getByRole('article', { name: 'September rent' })).toHaveCount(0);

  const fuel = p2.getByRole('article', { name: 'Blurry fuel slip' });
  await fuel.getByRole('button', { name: 'Send back' }).click();
  await fuel.getByLabel('What is wrong?').fill('Too blurry to read');
  await fuel.getByRole('button', { name: 'Send back' }).last().click();
  await expect(p2.getByRole('article', { name: 'Blurry fuel slip' })).toHaveCount(0);
  await p2.getByRole('button', { name: 'Sent back' }).click();
  await expect(p2.getByRole('article', { name: 'Blurry fuel slip' })).toContainText('Sent back: Too blurry to read');
  expect((await p2.request.post('/api/inbox', { data: { title: 'x', name: 'x.pdf', type: 'application/pdf', data: pdf.toString('base64') } })).status()).toBe(403);
  await ctx2.close();

  // the business sees what happened
  await page.reload();
  await page.getByRole('button', { name: 'Sent back' }).click();
  await expect(page.getByRole('article', { name: 'Blurry fuel slip' })).toContainText('Too blurry to read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('article', { name: 'September rent' })).toContainText('Done by');
});
