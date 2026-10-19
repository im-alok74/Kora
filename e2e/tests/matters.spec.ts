import { expect, test } from '@playwright/test';
import { db, makeBusiness, signedIn } from '../helpers';

test('a lawyer opens a matter, records time and expenses, and bills them on one draft invoice', async ({ page, context }) => {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId, 'Rao and Associates');
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Mehta Exports', stateCode: '27' } });

  await page.goto('/app/matters');
  await expect(page.getByRole('heading', { name: 'Matters' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No matters here.' })).toBeVisible();
  await page.getByRole('button', { name: 'New matter' }).click();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Mehta Exports' });
  await page.getByLabel('Matter title').fill('Recovery suit against Delta Ltd');
  await page.getByLabel('Case or file number (optional)').fill('CS-102/2026');
  await page.getByLabel('Hourly rate (Rs)').fill('3000');
  await page.getByRole('button', { name: 'Create matter' }).click();
  await expect(page.getByRole('heading', { name: 'Recovery suit against Delta Ltd' })).toBeVisible();

  // time: three ways of writing a duration, and a bad one
  await page.getByLabel('Time', { exact: true }).fill('1:30');
  await page.getByLabel('What was done').fill('Drafting the plaint');
  await page.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Time recorded.' })).toBeVisible();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 4,500.00');
  await page.getByLabel('Time', { exact: true }).fill('45m');
  await page.getByLabel('What was done').fill('Call with the client');
  await page.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 6,750.00');
  await page.getByLabel('Time', { exact: true }).fill('banana');
  await page.getByLabel('What was done').fill('Nonsense');
  await page.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter the time as' })).toBeVisible();
  await page.getByLabel('Time', { exact: true }).fill('');

  // an expense paid at cost, which carries no GST
  await page.getByLabel('What it was for').fill('Court fee');
  await page.getByLabel('Amount (Rs)').first().fill('1500');
  await page.getByLabel(/Paid on the client/).check();
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 8,250.00');

  // client money, and a refund that is larger than what is held
  await page.getByLabel('Amount (Rs)').last().fill('10000');
  await page.getByLabel('Note (cheque number, reference)').fill('Cheque 4412');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('held')).toHaveText('Rs 10,000.00');
  await page.getByLabel('What happened').selectOption('refund');
  await page.getByLabel('Amount (Rs)').last().fill('15000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Only Rs 10000.00 is held' })).toBeVisible();
  await expect(page.getByTestId('held')).toHaveText('Rs 10,000.00');

  // bill it
  await page.getByRole('button', { name: 'Create draft invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  // taxable 8,250 (4,500 + 2,250 + 1,500), GST 18% on 6,750 = 1,215, total 9,465
  await expect(page.locator('.doc-amount .big')).toHaveText('Rs 9,465.00');
  const id = page.url().split('/').pop()!;
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.document.notes).toBe('Matter: CS-102/2026: Recovery suit against Delta Ltd');
  expect(doc.lines).toHaveLength(3);

  // back on the matter: nothing is left to bill, and the entries are tied to the invoice
  await page.goto('/app/matters');
  await page.getByRole('link', { name: 'Recovery suit against Delta Ltd' }).click();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 0.00');
  await expect(page.getByRole('button', { name: 'Create draft invoice' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Draft invoice' }).first()).toBeVisible();
  const rows = await db`select count(*)::int as n from matter_entry where business_id = ${b.businessId} and invoiced_document_id = ${id}`;
  expect(rows[0]!.n).toBe(3);

  await page.getByRole('button', { name: 'Close matter' }).click();
  await page.goto('/app/matters');
  await expect(page.getByRole('heading', { name: 'No matters here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(page.getByRole('link', { name: 'Recovery suit against Delta Ltd' })).toBeVisible();
});

test('an accountant sees matters but cannot record time, and another business sees nothing', async ({ page, context, browser }) => {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId, 'Chambers');
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Client One', stateCode: '27' } });
  const parties = await (await page.request.get('/api/parties')).json();
  const m = await (await page.request.post('/api/matters', { data: { partyId: parties.parties[0].id, title: 'Private matter', rate: '1000' } })).json();
  expect(m.id).toBeTruthy();

  const { createHash, randomBytes } = await import('node:crypto');
  const [ca] = await db`insert into app_user (email) values (${`ca${Date.now()}@example.test`}) returning id`;
  await db`insert into member (business_id, user_id, role) values (${b.businessId}, ${ca!.id}, 'accountant')`;
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${ca!.id}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  const ctx2 = await browser.newContext();
  await ctx2.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const p2 = await ctx2.newPage();
  await p2.goto(`/app/matters/${m.id}`);
  await expect(p2.getByRole('heading', { name: 'Private matter' })).toBeVisible();
  await expect(p2.getByRole('button', { name: 'Add time' })).toHaveCount(0);
  await expect(p2.getByRole('button', { name: 'Create draft invoice' })).toHaveCount(0);
  expect((await p2.request.post(`/api/matters/${m.id}/time`, { data: { duration: '1', description: 'x' } })).status()).toBe(403);
  await ctx2.close();

  // a stranger's business cannot open it
  const ctx3 = await browser.newContext();
  const u3 = await signedIn(ctx3);
  await makeBusiness(u3.userId, 'Someone Else');
  const p3 = await ctx3.newPage();
  expect((await p3.request.get(`/api/matters/${m.id}`)).status()).toBe(404);
  expect((await p3.request.post(`/api/matters/${m.id}/funds`, { data: { kind: 'deposit', amount: '1' } })).status()).toBe(400);
  await ctx3.close();
});
