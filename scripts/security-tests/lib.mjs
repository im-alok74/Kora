// Attack harness for a LOCAL Kora instance. Never point this at production.
export const BASE = process.env.BASE ?? 'http://localhost:3320';
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) throw new Error('refusing to attack anything but localhost');

export class Client {
  constructor(name = 'anon') { this.name = name; this.jar = {}; this.headers = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, { json, body, headers = {}, raw = false, redirect = 'manual', timeout = 20000 } = {}) {
    const h = { ...this.headers, ...headers };
    const ck = this.cookieHeader();
    if (ck && !('cookie' in h)) h.cookie = ck;
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); if (!('content-type' in h)) h['content-type'] = 'application/json'; }
    let res;
    try { res = await fetch(BASE + path, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : payload, redirect, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { return { status: 0, error: String(e.message ?? e), text: '', headers: new Headers() }; }
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c)) delete this.jar[kv.slice(0, i)]; }
    const buf = raw ? Buffer.from(await res.arrayBuffer()) : null;
    const text = raw ? buf.toString('latin1') : await res.text();
    let j; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, text, json: j, buf, setCookie: res.headers.getSetCookie?.() ?? [] };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, json, o) { return this.req('POST', p, { json, ...o }); }
  patch(p, json, o) { return this.req('PATCH', p, { json, ...o }); }
  put(p, json, o) { return this.req('PUT', p, { json, ...o }); }
  del(p, o) { return this.req('DELETE', p, o); }
}

let n = 0;
export const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function signIn(identifier) {
  const c = new Client(identifier); c.headers['x-forwarded-for'] = `10.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}`;
  const a = await c.post('/api/auth/request', { identifier });
  const v = await c.post('/api/auth/verify', { identifier, code: '123456' });
  if (v.status !== 200) throw new Error(`sign-in failed for ${identifier}: ${v.status} ${v.text.slice(0, 120)}`);
  return c;
}
export async function newUser(tag = 'u') {
  const email = `${tag}.${uniq()}@pt.test`;
  const c = await signIn(email);
  c.email = email;
  c.me = (await c.get('/api/me')).json;
  return c;
}
/** A user with a registered business and a customer, an item and one issued invoice. */
export async function seededOwner(tag = 'owner') {
  const c = await newUser(tag);
  const gst = (await import('./gstin.mjs')).gstin('27', String(Math.floor(1000 + Math.random() * 8999)));
  const b = await c.post('/api/businesses', { legalName: `${tag} Traders ${uniq()}`, gstin: gst, stateCode: '27', registrationType: 'regular' });
  if (b.status !== 201) throw new Error('business: ' + b.status + b.text);
  c.businessId = b.json.businessId;
  c.headers['x-business-id'] = c.businessId;
  await c.post('/api/business/select', { businessId: c.businessId });
  const party = await c.post('/api/parties', { kind: 'customer', name: `Cust ${uniq()}`, stateCode: '27' });
  c.partyId = party.json?.id;
  const doc = await c.post('/api/documents', { docType: 'tax_invoice', partyId: c.partyId, lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }] });
  c.docId = doc.json?.id;
  const iss = await c.post(`/api/documents/${c.docId}/issue`, {});
  c.issued = iss.status === 200;
  return c;
}

export const findings = [];
export function record(id, area, title, verdict, evidence = '', severity = '') {
  // verdict: HELD (defence worked), VULN (exploitable), WEAK (partial / defence in depth), INFO
  findings.push({ id, area, title, verdict, severity, evidence: String(evidence).slice(0, 400) });
  const tag = { HELD: '  ok ', VULN: ' VULN', WEAK: ' weak', INFO: ' info' }[verdict];
  console.log(`${tag} [${id}] ${title}${evidence ? '  -> ' + String(evidence).slice(0, 160).replace(/\n/g, ' ') : ''}`);
}
export const uuidv4 = () => '00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
