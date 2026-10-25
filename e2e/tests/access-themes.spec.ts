import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

const THEMES = ['light', 'dark'] as const;
const PUBLIC = ['/', '/pricing', '/privacy', '/terms', '/refunds', '/help', '/login', '/download', '/import-guide', '/tools',
  '/tools/gst-calculator', '/tools/invoice-generator', '/tools/quotation-maker', '/tools/proforma-invoice-generator',
  '/tools/purchase-order-generator', '/tools/receipt-maker', '/tools/qr-code-generator', '/tools/barcode-generator',
  '/tools/qr-code-scanner', '/tools/barcode-scanner', '/tools/logo-maker', '/tools/gstin-validator', '/tools/amount-in-words'];
const APP = ['/app', '/app/invoices', '/app/invoices/new', '/app/customers', '/app/vendors', '/app/items', '/app/expenses', '/app/purchases', '/app/recurring',
  '/app/reports', '/app/bank', '/app/inbox', '/app/projects', '/app/price-lists', '/app/team', '/app/settings', '/app/security', '/app/data', '/app/developers'];

async function audit(page: Page, path: string, theme: string): Promise<string[]> {
  await page.goto(path);
  await page.getByRole('heading').first().waitFor();
  const res = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  return bad.map((v) => `${theme} ${path}: ${v.id} ${v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).join(' | ')}`);
}

for (const theme of THEMES) {
  test(`public pages have no serious accessibility violations (${theme})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ reducedMotion: 'reduce' }); // entrance animations fade text in; axe must see the settled colours
    await ctx.addInitScript((t) => localStorage.setItem('kora-theme', t), theme);
    const page = await ctx.newPage();
    const bad: string[] = [];
    for (const p of PUBLIC) bad.push(...await audit(page, p, theme));
    expect(bad).toEqual([]); // every page is scanned first, so one run lists all the problems
    await ctx.close();
  });

  test(`app screens have no serious accessibility violations (${theme})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('kora-theme', t), theme);
    const u = await signedIn(ctx);
    await makeBusiness(u.userId);
    const page = await ctx.newPage();
    const bad: string[] = [];
    for (const p of APP) bad.push(...await audit(page, p, theme));
    expect(bad).toEqual([]);
    await ctx.close();
  });
}
