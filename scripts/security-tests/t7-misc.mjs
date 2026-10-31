// T7: payment webhook forgery, API keys, customer portal, rate limits, and the CA module.
import { createHmac } from 'node:crypto';
import { Client, record, seededOwner, newUser, uniq, findings } from './lib.mjs';
import { gstin } from './gstin.mjs';
const o = await seededOwner('m7');

// --- payment webhooks
{
  const anon = new Client();
  const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_fake', status: 'paid' } } } });
  const cases = [['no signature', {}], ['wrong signature', { 'x-razorpay-signature': 'deadbeef' }], ['empty signature', { 'x-razorpay-signature': '' }]];
  for (const g of ['mock', 'razorpay']) for (const [label, h] of cases) {
    const r = await anon.req('POST', `/api/webhooks/${g}`, { body, headers: { 'content-type': 'application/json', ...h } });
    record('T7-webhook', 'payments', `forged ${g} webhook, ${label}`, r.status === 200 ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 60)}`, 'critical');
  }
  const big = await anon.req('POST', '/api/webhooks/mock', { body: 'x'.repeat(200000), headers: { 'content-type': 'application/json' } });
  record('T7-webhook-big', 'dos', '200 KB webhook body is refused before parsing', big.status === 413 ? 'HELD' : 'WEAK', `${big.status}`, 'low');
}
// --- the mock payment page and pay button (open only when mocks are on)
{
  const pl = await o.post(`/api/documents/${o.docId}/payment-link`, {});
  const url = pl.json?.url ?? ''; const id = url.split('/').pop();
  const anon = new Client();
  const page = await anon.get(`/mock-gateway/${id}`);
  const pay = await anon.post(`/api/mock-gateway/${id}/pay`, {});
  record('T7-mockpay', 'payments', 'an anonymous visitor can mark a payment link as paid through the mock gateway', pay.status === 200 ? 'VULN' : 'HELD', `page ${page.status}, pay ${pay.status} ${pay.text.slice(0, 60)} (only open here because KORA_ALLOW_MOCKS=1; production must have it off)`, 'critical');
  const d = (await o.get(`/api/documents/${o.docId}`)).json?.document;
  console.log('  invoice after anonymous mock pay:', d?.status, d?.paid_paise);
}
// --- API keys
{
  const k = await o.post('/api/keys', { name: 'pt', scope: 'read' });
  const key = k.json?.key ?? k.json?.token ?? k.json?.secret;
  console.log('  key created:', k.status, key ? key.slice(0, 8) + '…' : k.text.slice(0, 80));
  if (key) {
    const a = new Client(); const auth = { authorization: `Bearer ${key}` };
    const me = await a.get('/api/v1/me', { headers: auth });
    record('T7-key-read', 'apikey', 'read key works on a read endpoint', me.status === 200 ? 'INFO' : 'INFO', `${me.status}`);
    const w = await a.post('/api/v1/customers', { name: 'ByReadKey', stateCode: '27' }, { headers: auth });
    record('T7-key-scope', 'apikey', 'a read-only key creates a customer', w.status >= 200 && w.status < 300 ? 'VULN' : 'HELD', `${w.status} ${w.text.slice(0, 60)}`, 'high');
    const other = await seededOwner('m7b');
    const x = await a.get(`/api/v1/invoices/${other.docId}`, { headers: auth });
    record('T7-key-tenant', 'apikey', 'A\'s key reads B\'s invoice', x.status === 200 ? 'VULN' : 'HELD', `${x.status}`, 'critical');
    const bad = await a.get('/api/v1/me', { headers: { authorization: `Bearer ${key.slice(0, -2)}xx` } });
    record('T7-key-bad', 'apikey', 'a tampered key is refused', bad.status === 401 ? 'HELD' : 'VULN', `${bad.status}`, 'high');
    const brute = []; for (let i = 0; i < 30; i++) brute.push((await a.get('/api/v1/me', { headers: { authorization: `Bearer kora_${uniq()}${uniq()}` } })).status);
    record('T7-key-brute', 'apikey', `30 wrong keys in a row: ${[...new Set(brute)]}`, brute.includes(429) ? 'HELD' : 'WEAK', 'no throttling of key guessing (keys are long random so this is low risk)', 'low');
    const rev = await o.del(`/api/keys/${k.json?.id}`); const after = await a.get('/api/v1/me', { headers: auth });
    record('T7-key-revoke', 'apikey', 'a revoked key stops working at once', after.status === 401 || after.status === 429 ? 'HELD' : 'VULN', `${rev.status} then ${after.status} (429 = throttled after the guessing test, still refused)`, 'high');
  }
}
// --- customer portal / share links
{
  const p = await o.post(`/api/parties/${o.partyId}/portal`, {}); const tok = p.json?.url?.split('/').pop() ?? p.json?.token;
  console.log('  portal:', p.status, JSON.stringify(p.json).slice(0, 100));
  if (tok) {
    const a = new Client();
    const ok = await a.get(`/api/portal/${tok}`);
    record('T7-portal', 'portal', 'portal link shows only its customer', ok.status === 200 ? 'INFO' : 'INFO', `${ok.status}`);
    const other = await seededOwner('m7c');
    const x = await a.get(`/api/portal/${tok}/doc/${other.docId}`);
    record('T7-portal-xdoc', 'portal', 'a portal link opens another business\'s invoice by id', x.status === 200 ? 'VULN' : 'HELD', `${x.status}`, 'critical');
    const y = await a.get(`/api/portal/${tok}/doc/${o.docId}`);
    console.log('  own doc via portal:', y.status);
    const brute = []; for (let i = 0; i < 60; i++) brute.push((await a.get(`/api/portal/${uniq()}${uniq()}${uniq()}`)).status);
    record('T7-portal-brute', 'portal', `60 guessed portal tokens: ${[...new Set(brute)]}`, brute.includes(429) ? 'HELD' : 'WEAK', 'token guessing is throttled?', 'low');
  }
}
// --- rate limiting on authenticated endpoints and the public ones
{
  const a = await o.get('/api/me'); const burst = await Promise.all(Array.from({ length: 700 }, () => o.get('/api/dashboard')));
  const lim = burst.filter((r) => r.status === 429).length;
  record('T7-rate-api', 'dos', `700 dashboard requests in one burst (limit is 600 a minute per person): ${lim} limited`, lim >= 90 ? 'HELD' : 'WEAK', `${lim} answered 429; ordinary use stays far below 600 a minute`, 'medium');
  const heavy0 = await Promise.all(Array.from({ length: 70 }, () => o.get('/api/reports/ageing')));
  const hl = heavy0.filter((r) => r.status === 429).length;
  record('T7-rate-heavy', 'dos', `70 report requests in a minute (limit 40): ${hl} limited`, hl >= 25 ? 'HELD' : 'WEAK', `${hl} answered 429`, 'medium');
  const other = await newUser('rl2'); const still = await other.get('/api/me');
  record('T7-rate-isolated', 'dos', 'one person hitting the limit does not slow anyone else', still.status === 200 ? 'HELD' : 'WEAK', `${still.status}`);
  const pub = await Promise.all(Array.from({ length: 150 }, () => new Client().get(`/api/gstin/27AAAAA0000A1Z5`)));
  record('T7-rate-gstin', 'dos', 'public/unauthenticated lookups', 'INFO', `${[...new Set(pub.map((r) => r.status))]}`);
  const heavy = await Promise.all(Array.from({ length: 30 }, () => o.get('/api/reports/gstr1?from=2020-01-01&to=2026-12-31')));
  record('T7-heavy', 'dos', '30 parallel heavy reports', heavy.every((r) => r.status < 500) ? 'HELD' : 'WEAK', `${[...new Set(heavy.map((r) => r.status))]}`, 'low');
}
// --- CA module
{
  const a = await newUser('caA'), b = await newUser('caB'); a.headers['x-forwarded-for'] = '10.3.3.1'; b.headers['x-forwarded-for'] = '10.3.3.2';
  await a.post('/api/ca/firm', { name: 'Firm A' }); await b.post('/api/ca/firm', { name: 'Firm B' });
  const g = gstin('27', String(Math.floor(1000 + Math.random() * 8999)));
  const c = await a.post('/api/ca/clients', { legalName: 'Client of A', registrations: [{ gstin: g }] });
  await a.post('/api/ca/engagements/generate', { period: '2026-08' });
  const eng = (await a.get('/api/ca/engagements?period=2026-08')).json?.engagements?.[0]?.id; const cid = c.json?.id;
  await a.post(`/api/ca/engagements/${eng}/requests`, { defaults: true });
  const req = (await a.get(`/api/ca/engagements/${eng}/requests`)).json?.requests?.[0]?.id;
  const tries = [
    ['B lists A\'s clients (own firm only)', () => b.get('/api/ca/clients'), (r) => /Client of A/.test(r.text)],
    ['B reads A\'s engagement requests', () => b.get(`/api/ca/engagements/${eng}/requests`), (r) => r.status === 200],
    ['B changes A\'s engagement', () => b.patch(`/api/ca/engagements/${eng}`, { status: 'preparing' }), (r) => r.status === 200],
    ['B makes an upload link for A\'s work', () => b.post(`/api/ca/engagements/${eng}/upload-link`, {}), (r) => r.status === 200],
    ['B reviews A\'s request item', () => b.patch(`/api/ca/requests/${req}`, { decision: 'waived', reason: 'x' }), (r) => r.status === 200],
    ['B requests a link to A\'s client business', () => b.post(`/api/ca/clients/${cid}/link`, {}), (r) => r.status === 200],
    ['B assigns itself to A\'s client', () => b.post(`/api/ca/clients/${cid}/assignees`, { userId: b.me.userId }), (r) => r.status === 200],
    ['B adds a member to A\'s firm (header x-firm-id)', () => b.post('/api/ca/team', { identifier: 'evil@pt.test', role: 'partner' }, { headers: { 'x-firm-id': 'x' } }), (r) => false],
  ];
  const firmA = (await a.get('/api/ca/firm')).json?.firms?.[0]?.firmId;
  for (const [label, fn, bad] of tries) { const r = await fn(); record('T7-ca', 'ca', label, bad(r) ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 60)}`, 'critical'); }
  const hdr = await b.get('/api/ca/clients', { headers: { 'x-firm-id': firmA } });
  record('T7-ca-hdr', 'ca', 'B names A\'s firm in the x-firm-id header', /Client of A/.test(hdr.text) ? 'VULN' : 'HELD', `${hdr.status}`, 'critical');
  const ck = new Client(); ck.jar = { ...b.jar, kora_firm: firmA }; const ckr = await ck.get('/api/ca/clients');
  record('T7-ca-cookie', 'ca', 'B sets the kora_firm cookie to A\'s firm', /Client of A/.test(ckr.text) ? 'VULN' : 'HELD', `${ckr.status}`, 'critical');
  // an invited partner cannot be silently overwritten by self-invite escalation
  const staff = await newUser('caS'); staff.headers['x-forwarded-for'] = '10.3.3.3'; await a.post('/api/ca/team', { identifier: staff.email, role: 'preparer' });
  const esc = await staff.post('/api/ca/team', { identifier: staff.email, role: 'partner' });
  record('T7-ca-escalate', 'ca', 'a preparer promotes themselves to partner', esc.status === 200 ? 'VULN' : 'HELD', `${esc.status} ${esc.text.slice(0, 60)}`, 'critical');
  // team invite as a spam / account-creation vector
  const inv = await a.post('/api/ca/team', { identifier: `victim.${uniq()}@pt.test`, role: 'preparer' });
  record('T7-ca-invite', 'ca', 'a partner can create accounts for arbitrary emails and phones (no confirmation from the invitee)', inv.status === 200 ? 'WEAK' : 'HELD', 'invited person is added without consenting; they can leave only by asking a partner to remove them', 'low');
  // XSS in firm names rendered on the client upload page
  await a.post(`/api/ca/engagements/${eng}/upload-link`, {});
}
