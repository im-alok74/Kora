// Development only. Walks signed-in screens at three widths in both themes: screenshot, axe, overflow, console errors, time to heading.
// Usage: BASE=http://localhost:3540 TOKEN=<session> OUT=dir ROUTES=/app,/app/invoices WIDTHS=1280,768,390 pnpm exec tsx scripts/ui-walk.ts
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE ?? 'http://localhost:3540';
const out = process.env.OUT ?? 'shots';
const widths = (process.env.WIDTHS ?? '1280,768,390').split(',').map(Number);
const themes = (process.env.THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
const routes = (process.env.ROUTES ?? '').split(',').filter(Boolean);
const shoot = process.env.SHOTS !== '0';
const browser = await chromium.launch();
for (const theme of themes) for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.addCookies([{ name: 'kora_session', value: process.env.TOKEN!, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await ctx.addInitScript((t) => { try { localStorage.setItem('kora-theme', t); } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 140)));
  for (const p of routes) {
    const t0 = Date.now();
    await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    const gotH1 = await page.waitForSelector('main h1, h1', { timeout: 20_000 }).then(() => true).catch(() => false);
    const ms = Date.now() - t0;
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const slug = p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    if (shoot) await page.screenshot({ path: `${out}/${slug}-${width}-${theme}.png`, fullPage: true }).catch(() => {});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const title = await page.title();
    const h1 = await page.locator('h1').first().textContent().catch(() => '');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).exclude('iframe').analyze().catch(() => null);
    const bad = axe ? axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical') : [];
    console.log(JSON.stringify({ p, width, theme, ms, h1: gotH1 ? (h1 ?? '').trim().slice(0, 40) : 'NO H1', title: title.slice(0, 40), overflow, axe: bad.map((v) => `${v.id}(${v.nodes.length}:${(v.nodes[0]?.target ?? []).join(' ').slice(0, 50)})`), console: [...new Set(errors)] }));
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();
