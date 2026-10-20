// Development only. Makes a demo user, a business with customers, items and a few invoices in the local `kora` database,
// and prints a session token. Use it to look at the app: set a cookie `kora_session=<token>` on localhost:3000.
// Usage: pnpm exec tsx scripts/demo-seed.ts
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const db = postgres('postgres://kora_owner:kora_owner_dev@localhost:54329/kora', { max: 2, onnotice: () => {} });

function gstin(state: string, pan: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const base = `${state}${pan}1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]!) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
  return base + chars[(36 - (t % 36)) % 36];
}

const stamp = Date.now().toString(36);
const [u] = await db`insert into app_user (email) values (${`demo${stamp}@example.test`}) returning id`;
const token = randomBytes(32).toString('base64url');
await db`insert into app_session (user_id, token_hash, expires_at) values (${u!.id}, ${createHash('sha256').update(token).digest()}, now() + interval '7 days')`;
const [b] = await db`select create_business(${u!.id}, ${'Kapoor Services'}, ${gstin('27', `ABCDE${Math.floor(1000 + Math.random() * 8999)}F`)}, '27', 'regular') as id`;
await db`update business set address = ${db.json({ line1: '14 Gokhale Road, Shivaji Nagar', city: 'Pune', pincode: '411005' })}, phone = '98765 43210', upi_vpa = 'kapoor@okhdfc',
  bank_details = ${db.json({ accountName: 'Kapoor Services', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank, Pune' })} where id = ${b!.id}`;

const headers = { 'content-type': 'application/json', cookie: `kora_session=${token}` };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j as any;
};

const customers = [['Mehta Textiles Pvt Ltd', '27', gstin('27', 'AABCM1234F')], ['Sharma Electricals', '07', gstin('07', 'AAKFS5678G')], ['Iyer and Co', '29', gstin('29', 'AAAFI9012H')], ['Walk-in Retail', '27', null]] as const;
const ids: string[] = [];
for (const [name, stateCode, g] of customers) {
  await call('POST', '/api/parties', { kind: 'customer', name, stateCode, gstin: g, billingAddress: { line1: '221 Market Road', city: 'Mumbai', pincode: '400002' }, email: 'accounts@example.test', phone: '9988776655' });
}
const parties = (await call('GET', '/api/parties')).parties as { id: string; name: string }[];
for (const p of parties) ids.push(p.id);
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const plan: [number, number, string, string, string, number][] = [
  [0, -40, 'Monthly retainer, accounts and GST returns', '998221', '12000', 1800], [1, -25, 'Cabling work, 24 port patch panel', '995463', '4500', 1800],
  [2, -12, 'Consulting hours', '998313', '8500', 1800], [0, -5, 'Quarterly audit support', '998221', '30000', 1800], [3, -1, 'Printed stationery', '4820', '1250', 1200],
];
for (const [pi, off, desc, hsn, rate, bp] of plan) {
  const d = await call('POST', '/api/documents', { docType: 'tax_invoice', partyId: ids[pi], dueDate: iso(off + 15), lines: [{ name: desc, hsnSac: hsn, quantity: '1', rate, taxRateBp: bp }] });
  await call('POST', `/api/documents/${d.id}/issue`, {});
  await db`alter table document disable trigger user`;
  await db`update document set doc_date = ${iso(off)}, due_date = ${iso(off + 15)} where id = ${d.id}`;
  await db`alter table document enable trigger user`;
}
console.log(JSON.stringify({ token, businessId: b!.id }));
await db.end();
