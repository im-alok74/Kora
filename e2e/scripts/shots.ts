/**
 * Design review tool, not a test. Seeds a business with realistic data and screenshots the main pages at desktop and phone width.
 * Needs the app running on :3200 against the e2e database (see the README of this folder). Usage:
 *   pnpm exec tsx scripts/shots.ts <output folder> [page names...]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { db, makeBusiness, signedIn } from '../helpers';

const out = process.argv[2] ?? 'shots';
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const BASE = 'http://localhost:3200';

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } });
const user = await signedIn(context, `priya${Date.now().toString(36)}@acmetraders.example`);
const biz = await makeBusiness(user.userId, 'Acme Traders', '27');
await db`update business set phone = '+91 98200 11223', email = 'accounts@acmetraders.example', upi_vpa = 'acmetraders@upi',
         address = ${db.json({ line1: '14 Linking Road', city: 'Mumbai', pincode: '400050', stateCode: '27' })} where id = ${biz.businessId}`;
await db`update app_user set display_name = 'Priya Shah' where id = ${user.userId}`;
const api = context.request;
const post = async (path: string, data: unknown) => { const r = await api.post(path, { data }); if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`); return r.json(); };

const names: [string, string, string][] = [['Verma Stores', '27', '9820000001'], ['Sharma Electronics', '29', '9820000002'], ['Patel & Sons', '24', '9820000003'],
  ['Iyer Hardware', '33', '9820000004'], ['Gupta Traders', '07', '9820000005'], ['Nair Textiles', '32', '9820000006']];
const customers: string[] = [];
for (const [name, state, phone] of names) customers.push((await post('/api/parties', { kind: 'customer', name, stateCode: state, phone, email: `${phone}@example.test` })).id);
for (const [name, hsn, rate, kind] of [['Website design', '998314', '25000', 'service'], ['Monthly retainer', '998313', '12000', 'service'], ['LED panel 40W', '9405', '1850', 'goods'], ['Cabling work', '995446', '4500', 'service']]) {
  await post('/api/items', { name, hsnSac: hsn, kind, defaultRateBp: 1800, price: rate });
}
const line = (name: string, hsn: string, rate: string, qty = '1', kind = 'service') => ({ name, hsnSac: hsn, quantity: qty, rate, taxRateBp: 1800, kind });
const doc = async (o: Record<string, unknown>, issue = true) => {
  const d = await post('/api/documents', o);
  if (issue) await post(`/api/documents/${d.id}/issue`, {});
  return d.id as string;
};
const ids: string[] = [];
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[0], docDate: day(70), dueDate: day(55), lines: [line('Website design', '998314', '25000')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[1], docDate: day(48), dueDate: day(33), lines: [line('LED panel 40W', '9405', '1850', '24', 'goods')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[2], docDate: day(33), dueDate: day(18), lines: [line('Monthly retainer', '998313', '12000'), line('Cabling work', '995446', '4500')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[3], docDate: day(20), dueDate: day(5), lines: [line('Cabling work', '995446', '4500', '3')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[4], docDate: day(9), dueDate: day(-6), lines: [line('Monthly retainer', '998313', '12000')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[0], docDate: day(3), dueDate: day(-12), lines: [line('Website design', '998314', '25000'), line('Monthly retainer', '998313', '12000')] }));
ids.push(await doc({ docType: 'tax_invoice', partyId: customers[5], docDate: day(1), dueDate: day(-14), lines: [line('LED panel 40W', '9405', '1850', '60', 'goods')] }));
await post(`/api/documents/${ids[0]}/payments`, { amount: '29500', method: 'bank_transfer', receivedOn: day(50) });
await post(`/api/documents/${ids[1]}/payments`, { amount: '20000', method: 'upi', receivedOn: day(30) });
await post(`/api/documents/${ids[2]}/payments`, { amount: '19470', method: 'cash', receivedOn: day(10) });
await post(`/api/documents/${ids[4]}/payments`, { amount: '14160', method: 'upi', receivedOn: day(2) });
await doc({ docType: 'estimate', partyId: customers[1], docDate: day(4), dueDate: day(-10), lines: [line('Website design', '998314', '25000')] });
const acceptedEstimate = await doc({ docType: 'estimate', partyId: customers[3], docDate: day(12), dueDate: day(-3), lines: [line('Monthly retainer', '998313', '12000', '6')] });
await post(`/api/documents/${acceptedEstimate}/estimate`, { action: 'accept' });
await doc({ docType: 'tax_invoice', partyId: customers[2], docDate: day(0), lines: [line('Cabling work', '995446', '4500')] }, false);
for (const [category, amount, vendor, d] of [['Rent', '45000', 'Linking Road Estates', 20], ['Software and subscriptions', '2360', 'Cloud Tools', 14], ['Travel', '1180', 'City Cabs', 6], ['Utilities', '5400', 'Power Co', 4], ['Marketing', '8260', 'Print Studio', 2]] as const) {
  await post('/api/expenses', { date: day(d), category, amount, vendor, gst: category === 'Rent' ? '' : String(Math.round(Number(amount) * 0.18 / 1.18)), paidVia: 'upi' });
}
await post('/api/recurring', { name: 'Monthly retainer', partyId: customers[4], unit: 'month', startDate: day(-20), mode: 'issue_and_send', channel: 'whatsapp', termsDays: 15, lines: [line('Monthly retainer', '998313', '12000')] });
await post('/api/late-fees', {}).catch(() => {});

const mt = await post('/api/matters', { partyId: customers[0], title: 'Recovery suit against Delta Ltd', reference: 'CS-102/2026', rate: '3000' });
await post(`/api/matters/${mt.id}/time`, { duration: '1:30', description: 'Drafting the plaint', date: day(6) });
await post(`/api/matters/${mt.id}/time`, { duration: '45m', description: 'Conference with the client', date: day(3) });
await post(`/api/matters/${mt.id}/expense`, { description: 'Court fee', amount: '1500', pureAgent: true, date: day(2) });
await post(`/api/matters/${mt.id}/funds`, { kind: 'deposit', amount: '10000', note: 'Cheque 4412' });
const portal = await post(`/api/parties/${customers[0]}/portal`, {});
const pages: [string, string][] = [
  ['home', '/'], ['login', '/login'], ['dashboard', '/app'], ['invoices', '/app/invoices'], ['editor', '/app/invoices/new'], ['invoice', `/app/invoices/${ids[2]}`],
  ['customers', '/app/customers'], ['items', '/app/items'], ['reports', '/app/reports'], ['expenses', '/app/expenses'], ['settings', '/app/settings'],
  ['data', '/app/data'], ['developers', '/app/developers'], ['team', '/app/team'], ['recurring', '/app/recurring'], ['matters', '/app/matters'], ['matter', `/app/matters/${mt.id}`], ['activity', '/app/activity'], ['portal', new URL(portal.url).pathname],
];
for (const [name, path] of pages) {
  if (only.length && !only.includes(name)) continue;
  for (const [vp, size] of [['desktop', { width: 1360, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: size, deviceScaleFactor: 1 });
    if (!['home', 'login', 'portal'].includes(name)) await ctx.addCookies(await context.cookies());
    const p = await ctx.newPage();
    await p.goto(path, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/${name}-${vp}.png`, fullPage: name !== 'invoice' || vp === 'phone' });
    await ctx.close();
  }
  console.log('shot', name);
}
await browser.close();
await db.end();
