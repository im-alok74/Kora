import { expect, test, type BrowserContext } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

test('a customer opens their private portal, answers an estimate, pays, and reads their statement', async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  await owner(context);
  const asha = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Asha Stores', stateCode: '27', phone: '98765 43210' } })).json();
  const other = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Other Buyer', stateCode: '27' } })).json();
  const mk = async (partyId: string, extra: Record<string, unknown>, rate = '1000') => {
    const d = await (await page.request.post('/api/documents', { data: { partyId, lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' }], ...extra } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  };
  await mk(asha.id, { docType: 'tax_invoice', docDate: addDays(istToday(), -40), dueDate: addDays(istToday(), -10) });   // overdue
  await mk(asha.id, { docType: 'tax_invoice', dueDate: addDays(istToday(), 20) });
  await mk(asha.id, { docType: 'estimate', dueDate: addDays(istToday(), 10) }, '5000');
  await mk(other.id, { docType: 'tax_invoice' }, '7777');                                                                  // someone else's

  // the business makes a link and has ways to send it
  await page.goto('/app/customers');
  await page.getByRole('row', { name: /Asha Stores/ }).getByRole('button', { name: 'Portal' }).click();
  const panel = page.getByTestId('portal-panel');
  await expect(panel).toContainText('Client portal: Asha Stores');
  await panel.getByRole('button', { name: 'Make a link' }).click();
  const url = await panel.getByLabel('Link to send').inputValue();
  expect(url).toMatch(/\/portal\/[A-Za-z0-9_-]{20,}$/);
  await expect(panel.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /wa\.me\/919876543210\?text=/);
  await expect(panel.getByRole('link', { name: 'View statement' })).toHaveAttribute('href', new RegExp(`tab=statement&party=${asha.id}`));

  // the customer opens it with no sign-in
  const customer = await browser.newContext();
  const p = await customer.newPage();
  const res = await p.goto(url);
  expect(res!.headers()['x-robots-tag'] ?? '').toBe('');                                  // the page itself carries robots meta, set below
  await expect(p.getByRole('heading', { name: 'Acme Traders', exact: true })).toBeVisible();
  await expect(p.getByText('For Asha Stores')).toBeVisible();
  await expect(p.getByTestId('portal-owing')).toHaveText('Rs 2,360.00');
  await expect(p.getByTestId('portal-overdue')).toHaveText('Rs 1,180.00');
  await expect(p.getByText('Other Buyer')).toHaveCount(0);
  await expect(p.getByText('7,777')).toHaveCount(0);                                      // nothing from another customer
  expect(await p.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

  // answer the estimate
  await expect(p.getByRole('heading', { name: 'Estimates waiting for you', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Accept' }).click();
  await expect(p.getByText(/is accepted\./)).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Estimates waiting for you', exact: true })).toHaveCount(0);
  await expect(p.getByText('Accepted', { exact: true })).toBeVisible();

  // the statement shows what was billed
  await expect(p.getByTestId('portal-closing')).toHaveText('Rs 2,360.00');
  const csv = await p.request.get(`${url.replace('/portal/', '/api/portal/')}/statement?format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Tax invoice');

  // pay the overdue one through the payment page
  await p.getByRole('button', { name: /^Pay INV\/.*0001/ }).click();
  await expect(p.getByText('Test payment page.')).toBeVisible();
  await p.getByRole('button', { name: /Pay Rs 1,180.00/ }).click();
  await expect(p.getByText('Payment received. Thank you.')).toBeVisible();
  await p.goto(url);
  await expect(p.getByTestId('portal-owing')).toHaveText('Rs 1,180.00');
  await expect(p.getByTestId('portal-overdue')).toHaveText('Rs 0.00');
  await expect(p.getByRole('heading', { name: 'Payments we have received', exact: true })).toBeVisible();

  // opening a document page goes through a short-lived public link
  const [popup] = await Promise.all([p.waitForEvent('popup'), p.getByRole('link', { name: /INV\/.*0001/ }).first().click()]);
  await expect(popup.getByText('Tax Invoice').first()).toBeVisible();

  // the business sees the portal was opened, then stops it and the customer is locked out
  await page.reload();
  await page.getByRole('row', { name: /Asha Stores/ }).getByRole('button', { name: 'Portal' }).click();
  await expect(page.getByTestId('portal-panel')).toContainText(/Opened \d+ times?/);
  await page.getByTestId('portal-panel').getByRole('button', { name: 'Stop this link' }).click();
  await expect(page.getByTestId('portal-panel').getByRole('button', { name: 'Make a link' })).toBeVisible();
  await p.goto(url);
  await expect(p.getByRole('heading', { name: 'This link is not valid', exact: true })).toBeVisible();
  expect((await p.request.get(url.replace('/portal/', '/api/portal/'))).status()).toBe(404);
  await customer.close();
});

test('a guessed or malformed portal link opens nothing, and portal actions need a valid link', async ({ page, request }) => {
  for (const t of ['aaaaaaaaaaaaaaaaaaaaaaaa', 'short', "x'%20or%201=1"]) {
    expect((await request.get(`/api/portal/${t}`)).status()).toBe(404);
  }
  expect((await request.post('/api/portal/aaaaaaaaaaaaaaaaaaaaaaaa/estimate/00000000-0000-0000-0000-000000000000', { data: { action: 'accept' } })).status()).toBe(404);
  expect((await request.post('/api/portal/aaaaaaaaaaaaaaaaaaaaaaaa/pay/00000000-0000-0000-0000-000000000000', { data: {} })).status()).toBe(404);
  expect((await request.get('/portal/aaaaaaaaaaaaaaaaaaaaaaaa/open/00000000-0000-0000-0000-000000000000', { maxRedirects: 0 })).status()).toBe(404);
  await page.goto('/portal/aaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(page.getByRole('heading', { name: 'This link is not valid', exact: true })).toBeVisible();
  // writes must be JSON, like everywhere else
  expect((await request.post('/api/portal/aaaaaaaaaaaaaaaaaaaaaaaa/pay/00000000-0000-0000-0000-000000000000', { form: { a: 'b' } })).status()).toBe(415);
});
