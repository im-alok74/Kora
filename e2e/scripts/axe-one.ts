// Development only. Lists serious axe violations with the failing text colours for one page and theme.
// Usage: BASE=http://localhost:3420 THEME=dark WIDTH=390 pnpm exec tsx scripts/axe-one.ts /
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.env.WIDTH ?? 1280), height: 900 }, colorScheme: (process.env.THEME as 'dark' | 'light') ?? 'light' });
await ctx.addInitScript((t) => { try { localStorage.setItem('kora-theme', t); } catch { /* ignore */ } }, process.env.THEME ?? 'light');
const page = await ctx.newPage();
await page.goto((process.env.BASE ?? 'http://localhost:3420') + process.argv[2], { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(1500);
const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) for (const n of v.nodes.slice(0, 12)) console.log(v.id, n.target.join(' '), (n.any[0]?.message ?? '').slice(0, 150));
await browser.close();
