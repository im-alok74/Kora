import { createHash, createHmac, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { BrowserContext, Page } from '@playwright/test';
import { SECRET } from './playwright.config';

export const db = postgres('postgres://kora_owner:kora_owner_dev@localhost:54329/kora_e2e', { max: 3, onnotice: () => {} });

let n = 0;
export const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

/** A valid GSTIN for a state, unique per call so tests do not collide on the GSTIN uniqueness rule. */
export function gstin(state = '27', pan5?: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const r = (s: string, k: number) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join('');
  const base = `${state}${pan5 ?? r(letters, 5)}${r('0123456789', 4)}${r(letters, 1)}1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]!) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
  return base + chars[(36 - (t % 36)) % 36];
}

/** Test-only: recovers the code from the stored HMAC. The app has no back door for this. */
export async function recoverOtp(identifier: string): Promise<string> {
  const [c] = await db`select code_hash from otp_challenge where identifier = ${identifier} and consumed_at is null order by created_at desc limit 1`;
  if (!c) throw new Error('no challenge for ' + identifier);
  const want = Buffer.from(c.code_hash);
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, '0');
    if (createHmac('sha256', SECRET).update(`${identifier}:${code}`).digest().equals(want)) return code;
  }
  throw new Error('code not found');
}

/** Creates a user with a live session, and puts the cookie in the browser. Skips the login screen. */
export async function signedIn(context: BrowserContext, email = `u${uniq()}@example.test`): Promise<{ userId: string; email: string }> {
  const [u] = await db`insert into app_user (email) values (${email}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await db`insert into app_session (user_id, token_hash, expires_at) values (${u!.id}, ${createHash('sha256').update(token).digest()}, now() + interval '1 day')`;
  await context.addCookies([{ name: 'kora_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return { userId: u!.id as string, email };
}

/** Creates a business owned by the user directly in the database, with a known GSTIN. */
export async function makeBusiness(userId: string, name = 'Acme Traders', state = '27', overrides: { turnover?: string } = {}) {
  const g = gstin(state);
  const [r] = await db`select create_business(${userId}, ${name}, ${g}, ${state}, 'regular') as id`;
  if (overrides.turnover) await db`update business set turnover_band = ${overrides.turnover} where id = ${r!.id}`;
  return { businessId: r!.id as string, gstin: g };
}

export async function addUser(businessId: string, role: 'staff' | 'accountant') {
  const [u] = await db`insert into app_user (email) values (${`m${uniq()}@example.test`}) returning id`;
  await db`insert into member (business_id, user_id, role) values (${businessId}, ${u!.id}, ${role})`;
  return u!.id as string;
}

/** Fills the invoice editor for one line and returns. Uses the inline "new customer" form when a name is given. */
export async function fillInvoice(page: Page, o: { customer?: string; customerState?: string; desc?: string; hsn?: string; qty?: string; rate?: string; gst?: string }) {
  if (o.customer) {
    await page.getByLabel('Customer', { exact: true }).selectOption('__new');
    await page.getByLabel('Customer name').fill(o.customer);
    await page.getByLabel('State', { exact: true }).selectOption(o.customerState ?? '27');
    await page.getByRole('button', { name: 'Add customer' }).click();
    await page.getByLabel('Customer', { exact: true }).selectOption({ label: o.customer });
  }
  await page.getByLabel('Line 1 description').fill(o.desc ?? 'Consulting');
  await page.getByLabel('Line 1 HSN or SAC').fill(o.hsn ?? '998313');
  await page.getByLabel('Line 1 quantity').fill(o.qty ?? '1');
  await page.getByLabel('Line 1 rate').fill(o.rate ?? '1000');
  if (o.gst) await page.getByLabel('Line 1 GST rate').selectOption(o.gst);
}

/** A business that e-invoices: address filled in, e-invoicing on. */
export async function makeEinvoiceBusiness(userId: string, name = 'Acme Traders') {
  const b = await makeBusiness(userId, name, '27');
  await db`update business set einvoice_enabled = true, crossed_einvoice_threshold = true,
           address = ${db.json({ line1: '12 MG Road', city: 'Pune', pincode: '411001' })}, phone = '9876543210' where id = ${b.businessId}`;
  return b;
}
