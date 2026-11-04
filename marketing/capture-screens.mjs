// Captures sharp screenshots of the real app for the animated video (marketing/video). Local copy only, with the worker running
// so the WhatsApp send completes (mock messenger) and the public link is logged.
//   BASE=http://localhost:3400 node marketing/capture-screens.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/pdf/node_modules/playwright/index.mjs';
import postgres from '../packages/db/node_modules/postgres/src/index.js';

const BASE = process.env.BASE ?? 'http://localhost:3400';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('Only a local copy may be captured.');
const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const out = join(here, 'video', 'public', 'shots');
mkdirSync(out, { recursive: true });
const db = postgres('postgres://kora_owner:kora_owner_dev@localhost:54329/kora', { max: 1, onnotice: () => {} });

const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const r = (s, k) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join('');
function gstin(state = '27') {
  const base = `${state}${r(letters, 5)}${r('0123456789', 4)}${r(letters, 1)}1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
  return base + chars[(36 - (t % 36)) % 36];
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }));
const page = await ctx.newPage();
const shot = (name, o = {}) => page.screenshot({ path: join(out, `${name}.png`), ...o });

const phone = `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Use an emailed or texted code' }).click();
await page.getByLabel('Mobile number or email').fill(phone);
await page.getByRole('button', { name: 'Send code' }).click();
await page.getByLabel(/Six-digit code/).fill('123456');
await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
const g = gstin();
await page.getByLabel('Legal name of the business').fill('Sharma Traders');
await page.getByLabel('GSTIN').fill(g);
await page.getByRole('button', { name: 'Create business' }).click();
await page.waitForURL(/\/app/, { timeout: 90_000 });
await db`update business set upi_vpa = 'sharmatraders@okaxis' where gstin = ${g}`;

// The editor, filled.
await page.goto(`${BASE}/app/invoices/new`);
await page.getByRole('heading', { name: /New tax invoice/ }).waitFor({ timeout: 90_000 });
await page.getByLabel('Customer', { exact: true }).selectOption('__new');
await page.getByLabel('Customer name').fill('Verma Stores');
await page.getByLabel('State', { exact: true }).selectOption('27');
await page.getByRole('button', { name: 'Add customer' }).click();
await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Verma Stores' });
await page.getByLabel('Line 1 description').fill('LED panel 18W');
await page.getByLabel('Line 1 HSN or SAC').fill('9405');
await page.getByLabel('Line 1 quantity').fill('20').catch(() => {});
await page.getByLabel('Line 1 rate').fill('500');
await page.waitForTimeout(800);
await page.getByLabel('Line 1 description').scrollIntoViewIfNeeded();
await shot('editor-items');
const summary = page.locator('section, div').filter({ has: page.getByTestId('grand-total') }).last();
await page.getByTestId('grand-total').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('editor-summary');

// Issued and sent.
await page.getByRole('button', { name: 'Issue tax invoice' }).click();
await page.getByRole('heading', { name: /Tax invoice INV/ }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(800);
await shot('issued');
await page.getByLabel('Mobile number').fill('9876543210');
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.getByText('Sent by whatsapp.').waitFor({ timeout: 90_000 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
console.log('Sent step right after the banner:', await page.getByText(/Delivered|Not sent yet/).first().innerText());
await shot('sent');
const docUrl = page.url();

// What the customer opens: the public link from the WhatsApp message (the mock messenger writes it to the worker log).
const log = readFileSync(join(here, '..', 'marketing-worker.log'), 'utf8');
const link = [...log.matchAll(/View and download: (http\S+?)(?:"|\\| |$)/g)].at(-1)?.[1];
console.log('message link:', link);
const msg = [...log.matchAll(/\[mock-whatsapp\] to \+\d+: (.*?) View and download/g)].at(-1)?.[1];
console.log('message text:', msg);
const cust = await ctx.newPage();
await cust.goto(link);
await cust.waitForTimeout(1500);
await cust.screenshot({ path: join(out, 'customer-invoice.png'), fullPage: true });
const qr = cust.locator('img[alt*="UPI" i], img[src^="data:image"], svg').filter({ hasNot: cust.locator('xx') });
console.log('images on customer page:', await cust.locator('img').count(), 'svgs:', await cust.locator('svg').count());

// Paid.
await page.goto(docUrl);
await page.getByRole('heading', { name: /Tax invoice INV/ }).waitFor({ timeout: 90_000 });
await page.getByRole('button', { name: 'Record payment' }).click();
await page.waitForTimeout(800);
await shot('record-payment');
console.log(await page.locator('main').innerText().then((t) => t.slice(0, 900)));
await browser.close();
await db.end();
