import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { GATEWAY_SECRET } from '../playwright.config';
import { db, fillInvoice, makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}

async function issueOne(page: Page, o: Parameters<typeof fillInvoice>[1] = {}) {
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Verma Stores', rate: '1000', ...o });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  return page.url().split('/').pop()!.split('?')[0]!;
}

test('part payment then the balance closes the invoice, and too much is refused', async ({ page, context }) => {
  await owner(context);
  await issueOne(page);
  await expect(page.getByText('Rs 1,180.00 still due')).toBeVisible();
  await page.getByLabel('Amount received (Rs)').fill('2000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('more than the 1180.00 still due');
  await page.getByLabel('Amount received (Rs)').fill('500');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await expect(page.getByText('Part paid').first()).toBeVisible();
  await expect(page.getByText('Rs 680.00 still due')).toBeVisible();
  await page.getByLabel('Method').selectOption('upi');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
});

test('a manual payment can be removed by the owner and the balance returns', async ({ page, context }) => {
  await owner(context);
  await issueOne(page);
  await expect(page.getByLabel('Amount received (Rs)')).toHaveValue('1180.00');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Rs 1,180.00 still due')).toBeVisible();
});

test('the customer pays through the payment link and the invoice closes itself', async ({ page, context, browser }) => {
  await owner(context);
  await issueOne(page);
  await page.getByRole('button', { name: 'Create payment link' }).click();
  const link = await page.locator('a', { hasText: '/mock-gateway/' }).innerText();
  const customer = await browser.newContext();
  const cp = await customer.newPage();
  await cp.goto(link);
  await expect(cp.getByText('Test payment page.')).toBeVisible();
  await cp.getByRole('button', { name: /Pay Rs 1,180.00/ }).click();
  await expect(cp.getByText('Payment received. Thank you.')).toBeVisible();
  await customer.close();
  await page.reload();
  await expect(page.getByText('Fully paid.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'upi via mock' })).toBeVisible();
});

test('webhooks: a signed event is applied once, a repeat is harmless, a forged one is refused', async ({ page, context, request }) => {
  await owner(context);
  const id = await issueOne(page);
  const link = await (await page.request.post(`/api/documents/${id}/payment-link`, { data: {} })).json();
  const [row] = await db`select gateway_link_id from payment_link where id = ${link.id}`;
  const body = JSON.stringify({ event: 'payment_link.paid', payload: {
    payment_link: { entity: { id: row!.gateway_link_id, amount: 118000, reference_id: id } }, payment: { entity: { id: 'pay_' + randomBytes(4).toString('hex'), amount: 118000, method: 'card' } } } });
  const sig = createHmac('sha256', GATEWAY_SECRET).update(body).digest('hex');
  const eventId = 'evt_' + randomBytes(6).toString('hex');
  const headers = { 'content-type': 'application/json', 'x-mock-signature': sig, 'x-mock-event-id': eventId };
  const forged = await request.post('/api/webhooks/mock', { data: body, headers: { ...headers, 'x-mock-signature': '0'.repeat(64) } });
  expect(forged.status()).toBe(400);
  const first = await request.post('/api/webhooks/mock', { data: body, headers });
  expect(first.status()).toBe(200);
  expect((await first.json()).duplicate).toBe(false);
  const again = await request.post('/api/webhooks/mock', { data: body, headers });
  expect((await again.json()).duplicate).toBe(true);
  const [n] = await db`select count(*)::int as n from payment where gateway_event_id = ${eventId}`;
  expect(n!.n).toBe(1);
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.document.payment_status).toBe('paid');
  expect((await request.post('/api/webhooks/nope', { data: body, headers })).status()).toBe(404);
});

test('the invoice carries a UPI QR for what is due, and loses it once paid', async ({ page, context, browser }) => {
  const o = await owner(context);
  await db`update business set upi_vpa = 'acme@okhdfc' where id = ${o.businessId}`;
  const id = await issueOne(page);
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.locator('p.muted', { hasText: '/i/' }).innerText();
  const anon = await browser.newContext();
  const html = await (await anon.request.get(link)).text();
  expect(html).toContain('alt="UPI QR code"');
  expect(html).toContain('Scan to pay Rs 1,180.00');
  expect(html).toContain('UPI: acme@okhdfc');
  await page.request.post(`/api/documents/${id}/payments`, { data: { amount: '1180', method: 'cash' } });
  const paid = await (await anon.request.get(link)).text();
  expect(paid).not.toContain('UPI QR code');
  await anon.close();
});

test('a sent message goes through the worker queue, and a reminder arrives on schedule', async ({ page, context }) => {
  test.setTimeout(120_000);
  const o = await owner(context);
  await page.goto('/app/settings');
  await page.getByLabel('Send reminders automatically').check();
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.getByText('Reminder settings saved.')).toBeVisible();
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Verma Stores', rate: '1000' });
  await page.getByLabel('Due date').fill('2099-05-10');
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const id = page.url().split('/').pop()!.split('?')[0]!;
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Sent by whatsapp.')).toBeVisible({ timeout: 60_000 });
  await db`update party set phone = '9876543210' where business_id = ${o.businessId}`;
  const rs = await db`select id from reminder where document_id = ${id} order by scheduled_at`;
  expect(rs).toHaveLength(3);
  await db`update reminder set scheduled_at = now() - interval '1 minute' where id = ${rs[0]!.id}`;
  await expect.poll(async () => (await db`select delivery_status from reminder where id = ${rs[0]!.id}`)[0]!.delivery_status, { timeout: 60_000 }).toBe('sent');
  const [del] = await db`select status, provider_message_id from delivery where document_id = ${id} order by created_at desc limit 1`;
  expect(del).toMatchObject({ status: 'sent' });
});
