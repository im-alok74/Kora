// Development only. Screenshots app pages with a session token from demo-seed.
// Usage: pnpm exec tsx scripts/shots.ts <token> <outDir> <width> <path>...   (paths like /app/invoices)
import { chromium } from '@playwright/test';

const [token, out, width, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, colorScheme: (process.env.COLOR as 'dark' | 'light' | undefined) ?? 'light' });
await ctx.addCookies([{ name: 'kora_session', value: token!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
if (process.env.COLOR === 'dark') await ctx.addInitScript(() => localStorage.setItem('kora-theme', 'dark'));
const page = await ctx.newPage();
for (const p of paths) {
  await page.goto(`${process.env.BASE ?? 'http://localhost:3000'}${p}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('main h1', { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const file = `${out}/${p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${width}${process.env.COLOR === 'dark' ? '-dark' : ''}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
}
await browser.close();
