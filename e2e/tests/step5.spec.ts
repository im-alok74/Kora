import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, request as pwRequest, test, type BrowserContext } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}
const BASE = 'http://localhost:3200';
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('data can be exported to Excel, a backup and Tally, and customers imported from a spreadsheet', async ({ page, context }) => {
  test.setTimeout(120_000);
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Export Buyer', stateCode: '27' } })).json();
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000', taxRateBp: 1800 }] } })).json();
  const issued = await (await page.request.post(`/api/documents/${d.id}/issue`, { data: {} })).json();

  await page.goto('/app/data');
  await expect(page.getByRole('heading', { name: 'Your data', exact: true })).toBeVisible();

  // Excel: a real workbook (a ZIP whose parts are stored, so the sheet names are readable in the bytes)
  const xlsx = await page.request.get(await page.getByRole('link', { name: 'Download Excel file' }).evaluate((a) => (a as HTMLAnchorElement).href));
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(xlsx.headers()['content-disposition']).toMatch(/kora_data.*\.xlsx/);
  const xb = await xlsx.body();
  expect(xb.subarray(0, 2).toString()).toBe('PK');
  expect(xb.toString('latin1')).toContain('xl/worksheets/sheet3.xml');
  expect(xb.toString('utf8')).toContain('Export Buyer');
  await page.getByRole('checkbox', { name: 'Expenses' }).uncheck();
  await expect(page.getByRole('link', { name: 'Download Excel file' })).toHaveAttribute('href', /datasets=customers,items,documents,document_lines,payments(&|$)/);
  for (const k of ['Customers', 'Items', 'Documents', 'Document lines', 'Payments']) await page.getByRole('checkbox', { name: k, exact: true }).uncheck();
  await expect(page.getByText('Choose at least one thing to include.')).toBeVisible();

  const backup = await page.request.get('/api/data/export?format=backup');
  expect(backup.headers()['content-type']).toBe('application/zip');
  const bb = (await backup.body()).toString('latin1');
  for (const name of ['README.txt', 'customers.csv', 'documents.csv', 'data.json']) expect(bb).toContain(name);

  const month = istToday().slice(0, 7);
  const tally = await page.request.get(`/api/data/tally?from=${month}-01&to=${istToday()}&salesLedger=Sales%20-%20GST`);
  expect(tally.headers()['content-type']).toContain('application/xml');
  const xml = await tally.text();
  expect(xml).toContain('<ENVELOPE>');
  expect(xml).toContain(`<VOUCHERNUMBER>${issued.document.number}</VOUCHERNUMBER>`);
  expect(xml).toContain('<LEDGERNAME>Sales - GST</LEDGERNAME>');
  expect((await page.request.get('/api/data/tally?from=2026-01-01')).status()).toBe(400);               // dates are needed

  // import customers from a CSV
  const csv = ['Customer Name,Mobile,State,GST Number', 'Imported One,9876500001,Karnataka,', 'Imported Two,,Atlantis,', 'Export Buyer,,Kerala,'].join('\r\n');
  await page.getByLabel('CSV file').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = page.getByTestId('import-preview');
  await expect(preview).toBeVisible();
  await expect(page.getByTestId('count-ok')).toHaveText('1');
  await expect(page.getByTestId('count-dup')).toHaveText('1');
  await expect(page.getByTestId('count-err')).toHaveText('1');
  await expect(preview).toContainText('Atlantis');
  await expect(preview).toContainText('Already in Kora');
  await page.getByRole('button', { name: 'Import 1 customer' }).click();
  await expect(page.getByTestId('import-result')).toContainText('1 added');
  await page.goto('/app/customers');
  await expect(page.getByRole('cell', { name: 'Imported One' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Imported Two' })).toHaveCount(0);

  await page.goto('/app/data');
  await page.getByLabel('CSV file').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('count-ok')).toHaveText('0');                                           // trying again adds nothing
  await expect(page.getByText('There is nothing new to import.')).toBeVisible();
  await page.getByLabel('CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('mobile,city\n1,2') });
  await expect(page.locator('p[role="alert"]')).toContainText('column called name');
});

test('an API key reads and writes through /api/v1, retries are safe, and revoking stops it', async ({ page, context }) => {
  test.setTimeout(120_000);
  await owner(context);
  await page.goto('/app/developers');
  const makeKey = async (name: string, scope: string) => {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Access').selectOption(scope);
    await page.getByRole('button', { name: 'Make a key' }).click();
    const key = await page.getByLabel('New API key').inputValue();
    await page.getByRole('button', { name: 'I have saved it' }).click();
    return key;
  };
  const writeKey = await makeKey('Integration', 'write');
  const readKey = await makeKey('Dashboard', 'read');
  expect(writeKey).toMatch(/^kora_[A-Za-z0-9_-]{32}$/);
  await expect(page.getByRole('row', { name: /Integration/ })).toContainText(writeKey.slice(0, 10));
  await expect(page.locator('body')).not.toContainText(writeKey);                                       // the key is gone from the page once saved

  const api = (key: string) => pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const w = await api(writeKey), r = await api(readKey);
  const me = await (await w.get('/api/v1/me')).json();
  expect(me).toMatchObject({ access: 'write', business: { legal_name: 'Acme Traders' } });

  const cust = await w.post('/api/v1/customers', { data: { name: 'API Customer', stateCode: '27', phone: '9000011111' } });
  expect(cust.status()).toBe(201);
  const customerId = (await cust.json()).id;
  expect((await (await w.get(`/api/v1/customers/${customerId}`)).json()).data).toMatchObject({ name: 'API Customer', state_code: '27' });
  expect((await (await w.get('/api/v1/customers?q=API')).json()).data).toHaveLength(1);

  const body = { docType: 'tax_invoice', partyId: customerId, issue: true, lines: [{ name: 'Service', hsnSac: '998313', quantity: '2', rate: '500.00', taxRateBp: 1800, kind: 'service' }] };
  const key = `order-${Date.now()}-abcd`;
  const first = await w.post('/api/v1/invoices', { data: body, headers: { 'idempotency-key': key } });
  expect(first.status()).toBe(201);
  const inv = await first.json();
  expect(inv).toMatchObject({ status: 'issued', number: expect.stringMatching(/^INV\//) });
  const again = await w.post('/api/v1/invoices', { data: body, headers: { 'idempotency-key': key } });
  expect(again.status()).toBe(200);                                                                      // a retry: the same document, not a second
  expect(await again.json()).toMatchObject({ id: inv.id, number: inv.number });
  expect((await (await w.get('/api/v1/invoices?type=tax_invoice')).json()).data).toHaveLength(1);

  const got = (await (await r.get(`/api/v1/invoices/${inv.id}`)).json()).data;                           // a read key can read it
  expect(got.document).toMatchObject({ status: 'issued', grand_total_paise: '118000' });
  expect(got.document.created_by).toBeUndefined();
  expect(got.lines).toHaveLength(1);

  const pay = await w.post(`/api/v1/invoices/${inv.id}/payments`, { data: { amount: '500.00', method: 'upi' } });
  expect(pay.status()).toBe(201);
  expect(await pay.json()).toMatchObject({ paymentStatus: 'part_paid' });
  expect((await (await r.get('/api/v1/payments')).json()).total).toBe('50000');
  const share = await (await w.post(`/api/v1/invoices/${inv.id}/share`, { data: {} })).json();
  expect(share.url).toMatch(/\/i\/[A-Za-z0-9_-]+$/);

  // what the keys may not do
  const denied = await r.post('/api/v1/customers', { data: { name: 'Nope', stateCode: '27' } });
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: 'forbidden', message: expect.stringContaining('read-only') } });
  expect((await w.post(`/api/v1/invoices/${inv.id}/issue`, { data: {} })).status()).toBe(400);           // already issued
  expect((await w.get('/api/v1/invoices/00000000-0000-0000-0000-000000000000')).status()).toBe(404);
  expect((await w.get('/api/v1/invoices/not-a-uuid')).status()).toBe(404);
  const bad = await w.post('/api/v1/invoices', { data: { docType: 'tax_invoice', partyId: customerId, lines: [] } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('line') });
  expect((await w.post('/api/v1/customers', { data: 'x', headers: { 'content-type': 'text/plain' } })).status()).toBe(415);
  expect((await w.post('/api/v1/invoices', { data: body, headers: { 'idempotency-key': 'short' } })).status()).toBe(400);

  const anon = await pwRequest.newContext({ baseURL: BASE });
  for (const h of [{}, { authorization: 'Bearer nope' }, { authorization: `Bearer ${writeKey}x` }, { authorization: `Basic ${writeKey}` }] as Record<string, string>[]) {
    const res = await anon.get('/api/v1/me', { headers: h });
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toBe('Bearer');
    expect((await res.json()).error.code).toBe('unauthorized');
  }
  expect((await anon.get('/api/v1/invoices', { headers: { cookie: (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } })).status()).toBe(401);   // a browser session is not an API key

  // revoke: it stops at once
  page.on('dialog', (dlg) => void dlg.accept());
  await page.getByRole('row', { name: /Integration/ }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('row', { name: /Integration/ })).toContainText('Revoked');
  expect((await w.get('/api/v1/me')).status()).toBe(401);
  expect((await r.get('/api/v1/me')).status()).toBe(200);
});

test('a webhook is signed, delivered when an invoice is issued, and shows its history', async ({ page, context }) => {
  test.setTimeout(150_000);
  await owner(context);
  const got: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => { got.push({ headers: req.headers, body }); res.statusCode = 200; res.end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  try {
    await page.goto('/app/developers');
    await page.getByLabel('Web address (https)').fill(url);
    await page.getByLabel('Note (optional)').fill('Test receiver');
    await page.getByLabel(/A document is issued/).check();
    await page.getByRole('button', { name: 'Add webhook' }).click();
    const secret = await page.getByLabel('Signing secret').inputValue();
    expect(secret).toMatch(/^whsec_/);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByRole('row', { name: /Test receiver/ })).toContainText('A document is issued');

    await page.getByRole('button', { name: 'Send a test' }).click();
    await expect(page.getByText(/Works: the server answered 200/)).toBeVisible();
    expect(JSON.parse(got[0]!.body)).toMatchObject({ type: 'ping' });

    const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Hook Buyer', stateCode: '27' } })).json();
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000', taxRateBp: 1800 }] } })).json();
    const issued = await (await page.request.post(`/api/documents/${d.id}/issue`, { data: {} })).json();

    await expect.poll(() => got.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);                 // the worker sends it
    const evt = got.find((g) => g.headers['kora-event-type'] === 'document.issued')!;
    const sig = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(evt.headers['kora-signature'] as string)!;
    expect(createHmac('sha256', secret).update(`${sig[1]}.${evt.body}`).digest('hex')).toBe(sig[2]);       // the receiver can verify it
    expect(JSON.parse(evt.body)).toMatchObject({ type: 'document.issued', data: { id: d.id, number: issued.document.number, party_name: 'Hook Buyer', total_paise: '118000' } });

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText(/Delivered \(200\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('row', { name: /Test receiver/ })).toContainText('Off');
    const before = got.length;
    const d2 = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '10', taxRateBp: 1800 }] } })).json();
    await page.request.post(`/api/documents/${d2.id}/issue`, { data: {} });
    await page.waitForTimeout(6000);
    expect(got.length).toBe(before);                                                                       // switched off: nothing more is sent

    // an address that is not public is refused when saved (the allowance for localhost is only for these tests, so check a clearly bad one)
    await page.getByLabel('Web address (https)').fill('ftp://example.com/x');
    await page.getByLabel(/A document is issued/).check();
    await page.getByRole('button', { name: 'Add webhook' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('https');
  } finally { server.close(); }
});

test('only the owner sees Developers, and API keys and webhooks are owner-only on the server too', async ({ page, context, browser }) => {
  await owner(context);
  await page.goto('/app/developers');
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();
  const staff = await page.request.post('/api/team', { data: { identifier: '9811100001', role: 'staff' } });
  expect(staff.status()).toBe(200);
  const { createHash, randomBytes } = await import('node:crypto');
  const { db } = await import('../helpers');
  const [u] = await db`select id from app_user where phone = '+919811100001'`;
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${u!.id}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  const ctx2 = await browser.newContext();
  await ctx2.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const p2 = await ctx2.newPage();
  await p2.goto('/app/invoices');
  await expect(p2.getByRole('link', { name: 'Developers' })).toHaveCount(0);
  await expect(p2.getByRole('link', { name: 'Data' })).toBeVisible();
  await p2.goto('/app/developers');
  await expect(p2.getByText('API keys and webhooks are managed by the owner.')).toBeVisible();
  expect((await p2.request.get('/api/keys')).status()).toBe(403);
  expect((await p2.request.post('/api/keys', { data: { name: 'x', scope: 'write' } })).status()).toBe(403);
  expect((await p2.request.get('/api/outbound-webhooks')).status()).toBe(403);
  expect((await p2.request.get('/api/data/export?format=backup')).status()).toBe(403);                  // staff cannot take the whole business out
  await ctx2.close();
});
