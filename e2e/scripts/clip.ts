// Development only. Screenshots one region of a page: BASE, THEME, WIDTH, then path y height.
import { chromium } from '@playwright/test';
const [path, y, h] = process.argv.slice(2);
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: Number(process.env.WIDTH ?? 1280), height: 900 }, colorScheme: (process.env.THEME as 'dark' | 'light') ?? 'light' });
await c.addInitScript((t) => { try { localStorage.setItem('kora-theme', t); } catch { /* ignore */ } }, process.env.THEME ?? 'light');
const p = await c.newPage();
await p.goto((process.env.BASE ?? 'http://localhost:3420') + path, { waitUntil: 'networkidle', timeout: 90_000 });
await p.evaluate((yy) => window.scrollTo(0, yy), Number(y)); await p.waitForTimeout(3000);
await p.screenshot({ path: process.env.OUT ?? '../shots/clip.png', fullPage: true, clip: { x: 0, y: Number(y), width: Number(process.env.WIDTH ?? 1280), height: Number(h) } });
await b.close();
