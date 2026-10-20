import AxeBuilder from '@axe-core/playwright';
import { expect, test, request as pwRequest } from '@playwright/test';
import { db, makeBusiness, signedIn } from '../helpers';

const BASE = 'http://localhost:3200';
const SECRET = 'e2e-cron-secret-0123456789';

test('the public API reaches matters, purchases and stock, and a read key cannot write', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId, 'Api Chambers');
  const mk = async (scope: string) => (await (await page.request.post('/api/keys', { data: { name: scope, scope } })).json()).key as string;
  const write = await mk('write'), read = await mk('read');
  const as = (key: string) => pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const w = await as(write), r = await as(read);
  const json = { 'content-type': 'application/json' };

  const customer = await (await w.post('/api/v1/customers', { data: { name: 'Client One', stateCode: '27' }, headers: json })).json();
  const matter = await w.post('/api/v1/matters', { data: { partyId: customer.id, title: 'Lease dispute' }, headers: json });
  expect(matter.status()).toBe(201);
  const { id } = await matter.json();
  expect((await w.post(`/api/v1/matters/${id}/time`, { data: { duration: '1:30', description: 'Drafting', rate: '2000' }, headers: json })).status()).toBe(201);
  const one = await (await r.get(`/api/v1/matters/${id}`)).json();
  expect(JSON.stringify(one)).toContain('Drafting');
  expect((await (await r.get('/api/v1/matters?q=Lease')).json()).data).toHaveLength(1);

  const item = await (await w.post('/api/v1/items', { data: { name: 'Widget', kind: 'goods', hsnSac: '8479', defaultRateBp: 1800, price: '100', trackStock: true }, headers: json })).json();
  expect((await w.post(`/api/v1/stock/${item.id}/adjust`, { data: { mode: 'in', quantity: '25', note: 'Opening stock' }, headers: json })).status()).toBe(201);
  const stock = (await (await r.get('/api/v1/stock')).json()).data;
  expect(JSON.stringify(stock)).toContain('Widget');
  expect(JSON.stringify(stock)).toContain('25');

  expect((await r.get('/api/v1/purchases')).status()).toBe(200);
  expect((await r.post('/api/v1/matters', { data: { partyId: customer.id, title: 'x' }, headers: json })).status()).toBe(403);
  expect((await r.post(`/api/v1/stock/${item.id}/adjust`, { data: { mode: 'in', quantity: '1', note: 'x' }, headers: json })).status()).toBe(403);
  expect((await pwRequest.newContext({ baseURL: BASE }).then((c) => c.get('/api/v1/matters'))).status()).toBe(401);
  await w.dispose(); await r.dispose();
});

test('the jobs admin route needs the operator secret, shows queue health and requeues failures', async ({ request }) => {
  expect((await request.get('/api/admin/jobs')).status()).toBe(401);
  expect((await request.post('/api/admin/jobs', { data: {} })).status()).toBe(401);
  const auth = { authorization: `Bearer ${SECRET}` };
  const [j] = await db`insert into job (queue, payload, status, attempts, last_error) values ('e2e-queue', '{}', 'failed', 8, 'boom') returning id`;
  const view = await request.get('/api/admin/jobs', { headers: auth });
  expect(view.status()).toBe(200);
  const body = await view.json();
  expect(body.counts.some((c: { queue: string; status: string }) => c.queue === 'e2e-queue' && c.status === 'failed')).toBe(true);
  expect(body.failed.some((f: { id: string }) => f.id === j!.id)).toBe(true);
  const re = await request.post('/api/admin/jobs', { headers: auth, data: { queue: 'e2e-queue' } });
  expect((await re.json()).requeued).toBeGreaterThanOrEqual(1);
  const [after] = await db`select status, attempts from job where id = ${j!.id}`;
  expect(after).toMatchObject({ status: 'queued', attempts: 0 });
  await db`delete from job where id = ${j!.id}`;
});

test('the new pages have no serious accessibility violations', async ({ page, context }) => {
  test.setTimeout(300_000);
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  for (const path of ['/app', '/app/firm', '/app/inbox', '/app/matters', '/app/projects', '/app/purchases', '/app/itc', '/app/security', '/app/network', '/app/pos', '/app/reports', '/app/recurring', '/app/expenses', '/app/team', '/app/data', '/app/developers', '/app/activity', '/terms', '/privacy']) {
    await page.goto(path);
    await page.getByRole('heading').first().waitFor();
    const res = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`), path).toEqual([]);
  }
});
