import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { addUser, db, makeBusiness, signedIn } from '../helpers';

test('an accountant can read but the app offers no way to write, and the API refuses', async ({ page, context }) => {
  const o = await signedIn(await (await page.context().browser()!.newContext()));
  const b = await makeBusiness(o.userId);
  const accountant = await addUser(b.businessId, 'accountant');
  // sign the browser in as the accountant
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${accountant}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  await context.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/app/invoices');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New invoice' })).toHaveCount(0);
  const w = await page.request.post('/api/documents', { data: { docType: 'tax_invoice', lines: [{ name: 'x', hsnSac: '998313', quantity: '1', rate: '1', taxRateBp: 0 }] } });
  expect(w.status()).toBe(403);
  await page.goto('/app/settings');
  await expect(page.getByText('Only the owner can change settings.')).toBeVisible();
});

test('one business cannot see or touch another business', async ({ page, context }) => {
  const a = await signedIn(context);
  const ba = await makeBusiness(a.userId, 'Alpha Co', '27');
  const r = await page.request.post('/api/documents', { data: { docType: 'proforma', lines: [{ name: 'Secret', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 0 }] } });
  const id = (await r.json()).id as string;

  const other = await page.context().browser()!.newContext();
  const bUser = await signedIn(other);
  const bb = await makeBusiness(bUser.userId, 'Beta Co', '29');
  const p2 = await other.newPage();
  // own business: the document does not exist
  expect((await p2.request.get(`/api/documents/${id}`)).status()).toBe(404);
  expect(((await (await p2.request.get('/api/documents')).json()).documents)).toHaveLength(0);
  // naming the other business explicitly is refused
  expect((await p2.request.get('/api/documents', { headers: { 'x-business-id': ba.businessId } })).status()).toBe(403);
  // and a signed-out visitor gets nothing
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`/api/documents/${id}`)).status()).toBe(401);
  expect(bb.businessId).not.toBe(ba.businessId);
  await other.close(); await anon.close();
});

test('state-changing requests must be JSON', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  const r = await page.request.post('/api/parties', { form: { name: 'x' } });
  expect(r.status()).toBe(415);
});

test('pages have no serious accessibility violations', async ({ page, context }) => {
  test.setTimeout(300_000);
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  for (const path of ['/app/invoices', '/app/invoices/new', '/app/customers', '/app/items', '/app/settings']) {
    await page.goto(path);
    await page.getByRole('heading').first().waitFor();
    const res = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`), path).toEqual([]);
  }
  const anon = await page.context().browser()!.newContext();
  const p = await anon.newPage();
  await p.emulateMedia({ reducedMotion: 'reduce' }); // entrance animations fade text in; axe must see the settled colours
  await p.goto('/');
  await p.getByRole('heading').first().waitFor();
  const res = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `/: ${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).join(' | ')}`)).toEqual([]);
  await anon.close();
});

test('on a phone the list fits the screen', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/app/invoices');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
