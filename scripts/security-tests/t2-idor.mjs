// T2: tenant isolation. B is a real user of a different business and tries every way to reach A's data.
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Client, record, seededOwner, uuidv4, uniq, findings } from './lib.mjs';

const a = await seededOwner('A');
const b = await seededOwner('B');

// A creates one of everything it can.
const mk = async (label, p, body) => { const r = await a.post(p, body); if (![200, 201].includes(r.status)) console.log(`  (seed ${label}: ${r.status} ${r.text.slice(0, 100)})`); return r.json?.id ?? r.json?.[label + 'Id']; };
a.itemId = await mk('item', '/api/items', { name: 'Widget', hsnSac: '9983', unit: 'pcs', rate: '100', taxRateBp: 1800, kind: 'goods' });
a.vendorId = await mk('vendor', '/api/parties', { kind: 'vendor', name: 'Vendor A', stateCode: '27' });
a.expenseId = await mk('expense', '/api/expenses', { date: '2026-10-01', amount: '500', category: 'Travel', note: 'secret expense A' });
a.matterId = await mk('matter', '/api/matters', { title: 'Matter A secret', partyId: a.partyId });
a.priceListId = await mk('pl', '/api/price-lists', { name: 'PL A' });
a.recurringId = await mk('rec', '/api/recurring', { partyId: a.partyId, docType: 'tax_invoice', frequency: 'monthly', startDate: '2026-11-01', lines: [{ name: 'S', hsnSac: '998313', quantity: '1', rate: '10', taxRateBp: 1800, kind: 'service' }] });
a.hookId = (await a.post('/api/outbound-webhooks', { url: 'https://example.com/hook', events: ['invoice.issued'] })).json?.id;
a.keyId = (await a.post('/api/keys', { name: 'k' })).json?.id;
const pay = await a.post(`/api/documents/${a.docId}/payments`, { amount: '500', method: 'cash', date: '2026-10-29' });
a.paymentId = pay.json?.id ?? pay.json?.paymentId;
const seeded = { docId: a.docId, partyId: a.partyId, itemId: a.itemId, vendorId: a.vendorId, expenseId: a.expenseId, matterId: a.matterId, priceListId: a.priceListId, recurringId: a.recurringId, hookId: a.hookId, keyId: a.keyId, paymentId: a.paymentId };
console.log('A seeded:', JSON.stringify(seeded));

// Which A id fits a route segment name.
const idFor = (parent) => ({ documents: a.docId, parties: a.partyId, items: a.itemId, expenses: a.expenseId, matters: a.matterId, 'price-lists': a.priceListId, recurring: a.recurringId, 'outbound-webhooks': a.hookId, keys: a.keyId, payments: a.paymentId, purchases: a.vendorId, stock: a.itemId, inbox: uuidv4(), team: a.me?.userId ?? uuidv4(), 'custom-fields': uuidv4(), 'recurring-expenses': uuidv4(), deliveries: uuidv4(), network: uuidv4() }[parent]);

const ROOT = fileURLToPath(new URL('../../apps/web/app/api', import.meta.url));
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') files.push(p); } })(ROOT);

let calls = 0; const leaks = [], errs = [];
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/').replace(/\/route\.ts$/, '');
  if (!rel.includes('[') || /^(portal|webhooks|ca\/|v1|auth|mock-gateway|gstin)/.test(rel)) continue;
  const segs = rel.split('/');
  const src = readFileSync(file, 'utf8');
  const methods = [...new Set([...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]))];
  let path = '/api'; let prev = '';
  for (const s of segs) { path += '/' + (s.startsWith('[') ? (idFor(prev) ?? uuidv4()) : s); prev = s.startsWith('[') ? prev : s; }
  for (const m of methods) {
    const r = await b.req(m, path, ['GET', 'DELETE'].includes(m) ? {} : { json: {} });
    calls++;
    const body = r.text;
    const hasSecret = /secret expense A|Matter A secret|Vendor A|Cust |A Traders|Widget|PL A/.test(body);
    if (r.status >= 200 && r.status < 300 && (hasSecret || m !== 'GET')) leaks.push(`${m} ${rel} -> ${r.status} ${body.slice(0, 80)}`);
    if (r.status >= 500) errs.push(`${m} ${rel} -> ${r.status} ${body.slice(0, 80)}`);
  }
}
console.log(`cross-tenant calls: ${calls}`);
for (const l of leaks) record('T2-leak', 'tenant', 'B reached A resource', 'VULN', l, 'critical');
for (const e of errs) record('T2-500', 'tenant', 'cross-tenant call crashed (500)', 'WEAK', e, 'low');
record('T2-A', 'tenant', `B (other business) against A's ids on ${calls} route/method calls`, leaks.length ? 'VULN' : 'HELD', `${leaks.length} leaks, ${errs.length} server errors`);

// Header and cookie tricks: B has a valid session and tries to name A's business.
const tries = [
  ['x-business-id header = A', { headers: { 'x-business-id': a.businessId } }],
  ['x-kora-business header = A', { headers: { 'x-business-id': b.businessId, 'x-kora-business': a.businessId } }],
  ['x-kora-user header = A user', { headers: { 'x-business-id': b.businessId, 'x-kora-user': a.me?.userId ?? 'x' } }],
];
for (const [label, o] of tries) {
  const r = await b.get('/api/documents', o);
  const seesA = r.text.includes(a.docId);
  record('T2-hdr', 'tenant', label, seesA ? 'VULN' : 'HELD', `status ${r.status}`, seesA ? 'critical' : '');
}
{
  const c = new Client('cookie'); c.jar = { ...b.jar, kora_business: a.businessId }; delete c.headers['x-business-id'];
  const r = await c.get('/api/documents');
  record('T2-cookie', 'tenant', 'kora_business cookie set to A', r.text.includes(a.docId) ? 'VULN' : 'HELD', `status ${r.status}`, 'critical');
}
{
  // Mass assignment: B tries to create a record in A's business through the body.
  const r = await b.post('/api/parties', { kind: 'customer', name: 'Injected by B', stateCode: '27', business_id: a.businessId, businessId: a.businessId });
  const l = await a.get('/api/parties');
  record('T2-mass', 'tenant', 'mass assignment of business_id on create', l.text.includes('Injected by B') ? 'VULN' : 'HELD', `status ${r.status}`, 'critical');
}
{
  // Public share link of A's invoice: is its token guessable or does it leak other docs?
  const s = await a.post(`/api/documents/${a.docId}/share`, {});
  const tok = s.json?.token ?? s.json?.url?.split('/').pop();
  console.log('  share:', s.status, JSON.stringify(s.json).slice(0, 140));
  if (tok) {
    const anon = new Client('anon');
    const pub = await anon.get(`/i/${tok}`);
    record('T2-share', 'tenant', 'public invoice link opens only its invoice', pub.status === 200 ? 'INFO' : 'INFO', `GET /i/<token> = ${pub.status}`);
    const bogus = await anon.get(`/i/${tok.slice(0, -2)}xx`);
    record('T2-share-bad', 'tenant', 'altered share token is refused', bogus.status === 200 ? 'VULN' : 'HELD', `status ${bogus.status}`, 'high');
  }
}
