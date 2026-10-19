import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { db, makeBusiness, signedIn } from '../helpers';

async function userContext(browser: import('@playwright/test').Browser, userId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${userId}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  await ctx.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return ctx;
}

test('an invoice reaches the buyer on Kora, who accepts it into a purchase bill, and the seller sees that it was accepted', async ({ page, context, browser }) => {
  const seller = await signedIn(context);
  await makeBusiness(seller.userId, 'Maharashtra Steel', '27');
  const [bu] = await db`insert into app_user (email) values (${`buyer${Date.now()}@example.test`}) returning id`;
  const buyer = await makeBusiness(bu!.id as string, 'Karnataka Builders', '29');

  // the seller bills a customer whose GSTIN is the buyer's
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Karnataka Builders', stateCode: '29', gstin: buyer.gstin } });
  const parties = await (await page.request.get('/api/parties')).json();
  const draft = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: parties.parties[0].id, lines: [{ name: 'Steel rods', hsnSac: '7214', quantity: '10', rate: '500', taxRateBp: 1800 }] } })).json();
  expect((await page.request.post(`/api/documents/${draft.id}/issue`, { data: {} })).ok()).toBe(true);
  await page.goto(`/app/invoices/${draft.id}`);
  await expect(page.getByTestId('kora-delivery')).toContainText('Sent through Kora to Karnataka Builders: waiting for them to accept');

  const bctx = await userContext(browser, bu!.id as string);
  const bp = await bctx.newPage();
  await bp.goto('/app/network');
  await expect(bp.getByRole('heading', { name: 'Network', exact: true })).toBeVisible();
  await expect(bp.getByRole('tab', { name: /Invoices received \(1\)/ })).toBeVisible();
  const table = bp.getByRole('table', { name: 'Invoices received' });
  await expect(table).toContainText('Maharashtra Steel');
  await expect(table).toContainText('Rs 5,900.00');
  await table.getByRole('button', { name: 'Accept' }).click();
  await expect(bp.getByRole('heading', { name: /Bill INV\// })).toBeVisible();
  await expect(bp.getByTestId('bill-total')).toHaveText('Rs 5,900.00');
  await expect(bp.getByText('Received through Kora from Maharashtra Steel')).toBeVisible();
  await expect(bp.getByLabel('Totals')).toContainText('IGST');

  await page.reload();
  await expect(page.getByTestId('kora-delivery')).toContainText('they accepted it');
  await bctx.close();
});

test('a buyer rejects an invoice with a reason, and the seller sees the reason', async ({ page, context, browser }) => {
  const seller = await signedIn(context);
  await makeBusiness(seller.userId, 'Seller Co', '27');
  const [bu] = await db`insert into app_user (email) values (${`buyer${Date.now()}@example.test`}) returning id`;
  const buyer = await makeBusiness(bu!.id as string, 'Buyer Co', '27');
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Buyer Co', stateCode: '27', gstin: buyer.gstin } });
  const parties = await (await page.request.get('/api/parties')).json();
  const draft = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: parties.parties[0].id, lines: [{ name: 'Item', hsnSac: '7214', quantity: '1', rate: '100', taxRateBp: 1800 }] } })).json();
  await page.request.post(`/api/documents/${draft.id}/issue`, { data: {} });

  const bctx = await userContext(browser, bu!.id as string);
  const bp = await bctx.newPage();
  await bp.goto('/app/network');
  await bp.getByRole('button', { name: 'Reject' }).click();
  await bp.getByLabel('Why are you rejecting it?').fill('Wrong quantity');
  await bp.getByRole('button', { name: 'Reject invoice' }).click();
  await expect(bp.getByText('Rejected')).toBeVisible();
  await page.goto(`/app/invoices/${draft.id}`);
  await expect(page.getByTestId('kora-delivery')).toContainText('they rejected it (Wrong quantity)');
  await bctx.close();
});

test('a business lists itself and its catalogue, another finds it, sends an order, and the seller turns it into an invoice', async ({ page, context, browser }) => {
  const seller = await signedIn(context);
  await makeBusiness(seller.userId, 'Pune Packaging', '27');
  await page.request.post('/api/items', { data: { name: 'Corrugated box', kind: 'goods', hsnSac: '4819', defaultRateBp: 1800, price: '40', unit: 'NOS', networkListed: true } });
  await page.request.post('/api/items', { data: { name: 'Secret item', kind: 'goods', hsnSac: '4819', defaultRateBp: 1800, price: '1' } });
  await page.goto('/app/network');
  await page.getByRole('tab', { name: 'My listing' }).click();
  await page.getByLabel('Show my business in the directory').click();
  await expect(page.getByLabel('Show my business in the directory')).toBeChecked();
  await page.getByLabel('What do you sell?').fill('Boxes and packing material');
  await page.getByLabel('City').fill('Pune');
  await page.getByRole('button', { name: 'Save listing' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByText('1 item is in your catalogue')).toBeVisible();

  const [bu] = await db`insert into app_user (email) values (${`buyer${Date.now()}@example.test`}) returning id`;
  await makeBusiness(bu!.id as string, 'Nashik Foods', '27');
  const bctx = await userContext(browser, bu!.id as string);
  const bp = await bctx.newPage();
  await bp.goto('/app/network');
  await bp.getByRole('tab', { name: 'Directory' }).click();
  const card = bp.getByRole('article', { name: 'Pune Packaging' });
  await expect(card).toContainText('Boxes and packing material');
  await card.getByRole('button', { name: /^Catalogue/ }).click();
  const catalogue = bp.getByRole('table', { name: 'Catalogue' });
  await expect(catalogue).toContainText('Corrugated box');
  await expect(catalogue).not.toContainText('Secret item');
  await catalogue.getByRole('button', { name: 'Add to order' }).click();
  await bp.getByLabel('Order line 1 quantity').fill('200');
  await bp.getByRole('button', { name: 'Send order' }).click();
  await expect(bp.getByRole('status').filter({ hasText: 'Order PO-0001 sent to Pune Packaging.' })).toBeVisible();
  await expect(bp.getByRole('table', { name: 'Orders list' })).toContainText('Sent');

  await page.getByRole('tab', { name: 'Orders' }).click();
  await expect(page.getByRole('table', { name: 'Orders list' })).toContainText('Nashik Foods');
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page).toHaveURL(/\/app\/invoices\//);
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  const id = page.url().split('/').pop()!;
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.document.status).toBe('draft');
  expect(doc.lines[0]).toMatchObject({ item_name: 'Corrugated box', quantity: '200.000' });
  expect(doc.document.notes).toContain('Against order PO-0001');

  await bp.reload();
  await bp.getByRole('tab', { name: 'Orders' }).click();
  await bp.getByRole('button', { name: 'Orders I sent' }).click();
  await expect(bp.getByRole('table', { name: 'Orders list' })).toContainText('Accepted');
  await bctx.close();
});
