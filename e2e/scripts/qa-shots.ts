// Development only. Screenshots public pages at three widths in both themes, and runs axe on each.
// Usage: BASE=http://localhost:3420 OUT=dir pnpm exec tsx scripts/qa-shots.ts /login /tools ...
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const out = process.env.OUT ?? 'shots';
const base = process.env.BASE ?? 'http://localhost:3420';
const widths = (process.env.WIDTHS ?? '1280,768,390').split(',').map(Number);
const themes = (process.env.THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
const browser = await chromium.launch();
for (const theme of themes) for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem('kora-theme', t); } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  for (const p of process.argv.slice(2)) {
    await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
    await page.waitForSelector('h1', { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(900);
    const slug = p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    await page.screenshot({ path: `${out}/${slug}-${width}-${theme}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log(`${p} ${width} ${theme} overflow=${overflow} axe=${bad.map((v) => `${v.id}(${v.nodes.length}:${v.nodes[0]?.target?.join(' ')})`).join(', ') || 'ok'}${errors.length ? ' console=' + errors.join('|') : ''}`);
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();
