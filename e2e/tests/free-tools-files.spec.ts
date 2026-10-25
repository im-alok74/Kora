import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { TOOLS } from '../../apps/web/lib/tools';
import { readFileSync } from 'node:fs';

// The PDF, picture and text tools. Every input is made inside the test, so nothing depends on files from outside.
const NEW_TOOLS = TOOLS.map((t) => t.slug);   // every tool left on the site
const REMOVED = ['pdf-to-image', 'image-converter', 'image-compressor', 'images-to-pdf', 'merge-split-pdf', 'word-counter'];

/** A picture drawn on a canvas. `noisy` makes a large file that does not compress well. */
async function picture(page: Page, type: 'image/png' | 'image/jpeg' | 'image/webp', w: number, h: number, noisy = false): Promise<Buffer> {
  const b64 = await page.evaluate(async ([t, W, H, N]) => {
    const c = document.createElement('canvas'); c.width = W as number; c.height = H as number;
    const g = c.getContext('2d')!;
    g.fillStyle = '#106cd9'; g.fillRect(0, 0, W as number, H as number);
    if (N) { const d = g.getImageData(0, 0, W as number, H as number); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; } g.putImageData(d, 0, 0); }
    g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Kora', 20, 60);
    const blob: Blob = await new Promise((r) => c.toBlob((x) => r(x!), t as string, 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, [type, w, h, noisy] as const);
  return Buffer.from(b64, 'base64');
}

const isJpg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function saved(page: Page, click: () => Promise<void>): Promise<{ name: string; data: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), data: readFileSync(path) };
}


test('the hub and the sitemap list every new tool', async ({ page, request }) => {
  await page.goto('/tools');
  for (const t of ['GSTIN Validator', 'Amount in Words', 'Business Loan EMI Calculator', 'Profit Margin and Markup Calculator']) {
    await expect(page.locator('#all-tools').getByRole('link', { name: new RegExp(`^${t}`) })).toBeVisible();
  }
  for (const g of ['Documents', 'GST and pricing', 'QR, barcodes and logo']) await expect(page.getByRole('heading', { name: g })).toBeVisible();
  for (const r of REMOVED) await expect(page.locator(`a[href="/tools/${r}"]`)).toHaveCount(0);
  const map = await (await request.get('/sitemap.xml')).text();
  for (const s of NEW_TOOLS) expect(map).toContain(`/tools/${s}`);
  for (const r of REMOVED) expect(map, r).not.toContain(`/tools/${r}`);
});

test('the Tools menu in the header groups the tools and works from the keyboard', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /^Tools/ });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const pop = page.locator('.k-menu-pop');
  await expect(pop.getByRole('link', { name: 'GSTIN Validator' })).toBeVisible();
  await expect(pop.getByRole('group', { name: 'GST and pricing' })).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();   // a tap opens it too
  await expect(pop).toBeVisible();
});

test('GSTIN validator: decodes a good number, explains a bad one, checks a list', async ({ page }) => {
  await page.goto('/tools/gstin-validator');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByText('This GSTIN has a valid format and check character.')).toBeVisible();
  await expect(page.getByText('Maharashtra (code 27)')).toBeVisible();
  await expect(page.getByText('AAAPL1234C', { exact: true })).toBeVisible();
  const good = await page.getByLabel('GSTIN (or a list, one per line)').inputValue();
  await page.getByLabel('GSTIN (or a list, one per line)').fill(good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A'));
  await expect(page.getByText('This GSTIN is not valid.')).toBeVisible();
  await expect(page.getByText(/check character\) should be/)).toBeVisible();
  await page.getByLabel('GSTIN (or a list, one per line)').fill('27AAAPL1234C1Z');
  await expect(page.getByText('A GSTIN has 15 characters. This one has 14.')).toBeVisible();
  await page.getByLabel('GSTIN (or a list, one per line)').fill(`${good}\n98AAAPL1234C1Z5\n${good.toLowerCase()}`);
  await expect(page.getByText('2 of 3')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('98 is not a GST state code');
});

test('Amount in words: lakh and crore in English and Hindi', async ({ page }) => {
  await page.goto('/tools/amount-in-words');
  await page.getByLabel('Amount (Rs)').fill('1,23,456.50');
  await expect(page.getByText('Rs 1,23,456.50')).toBeVisible();
  await expect(page.locator('.tl-words p[lang="en"]')).toHaveText('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  await expect(page.locator('.tl-words p[lang="hi"]')).toHaveText('एक लाख तेईस हज़ार चार सौ छप्पन रुपये और पचास पैसे केवल');
  await page.getByLabel('English letters').selectOption('upper');
  await expect(page.locator('.tl-words p[lang="en"]')).toHaveText('RUPEES ONE LAKH TWENTY THREE THOUSAND FOUR HUNDRED FIFTY SIX AND FIFTY PAISE ONLY');
  await page.getByLabel('Amount (Rs)').fill('12.345');
  await expect(page.getByText(/at most 2 decimals/)).toBeVisible();
  await page.getByLabel('Amount (Rs)').fill('99999999999');
  await expect(page.getByText(/up to Rs 999 crore/)).toBeVisible();
  await page.getByLabel('Amount (Rs)').fill('');
  await page.getByRole('button', { name: '5,00,00,000' }).click();
  await expect(page.locator('.tl-words p[lang="en"]')).toContainText(/five crore/i);
});

test('the new tool pages fit a phone screen (390 px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const s of NEW_TOOLS) {
    await page.goto(`/tools/${s}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `/tools/${s} overflows by ${over}px`).toBeLessThanOrEqual(1);
  }
  await page.goto('/tools');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('the new tool pages have valid structured data and a canonical address', async ({ page }) => {
  for (const s of NEW_TOOLS) {
    await page.goto(`/tools/${s}`);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((x) => JSON.parse(x)['@type'])).toEqual(['SoftwareApplication', 'FAQPage', 'BreadcrumbList']);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tools/${s}$`));
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`the hub and the new tools have no serious accessibility violations (${theme})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('kora-theme', t), theme);
    const page = await ctx.newPage();
    const bad: string[] = [];
    for (const p of ['/tools', ...NEW_TOOLS.map((s) => `/tools/${s}`)]) {
      await page.goto(p);
      await page.getByRole('heading').first().waitFor();
      const res = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of res.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) bad.push(`${theme} ${p}: ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    }
    expect(bad).toEqual([]);
    await ctx.close();
  });
}

test('tool pages show six related tools, the footer strip is grouped, and the sitemap dates the tools', async ({ page, request }) => {
  await page.goto('/tools/invoice-generator');
  const more = page.locator('#more .vt-more a');
  await expect(more).toHaveCount(6);
  await expect(more.first()).toContainText(/Quotation Maker|Proforma|Purchase Order|Receipt Maker/);   // same group first
  await page.goto('/pricing');
  const strip = page.locator('.k-toolstrip');
  for (const g of ['Documents', 'GST and pricing', 'QR, barcodes and logo']) await expect(strip.getByRole('group', { name: g })).toBeVisible();
  await expect(strip.locator('a')).toHaveCount(16);
  const map = await (await request.get('/sitemap.xml')).text();
  expect(map).toMatch(/\/tools\/gstin-validator<\/loc>\s*<lastmod>2026-10-26/);
});

test('tool pages stay inside a script budget and carry no PDF engine', async ({ page }) => {
  // Budget in decoded KB of JavaScript, measured on a production build with headroom.
  const BUDGET: Record<string, number> = { '/tools': 480, '/tools/gst-calculator': 650, '/tools/logo-maker': 650 };
  for (const [path, kb] of Object.entries(BUDGET)) {
    let total = 0, pdfLib = false;
    const jobs: Promise<void>[] = [];
    page.removeAllListeners('response');
    page.on('response', (r) => { if (r.request().resourceType() === 'script') jobs.push(r.body().then((b) => { total += b.length; if (b.includes('PDFDocument') && b.includes('copyPages')) pdfLib = true; }).catch(() => {})); });
    await page.goto(path, { waitUntil: 'networkidle' });
    await Promise.all(jobs);
    expect(pdfLib, `${path} loaded pdf-lib`).toBe(false);
    expect(total / 1024, `${path} script size in KB`).toBeLessThan(kb);
  }
});

test('the calculators: margin and markup, EMI and interest give the known answers', async ({ page }) => {
  await page.goto('/tools/profit-margin-calculator');
  await page.getByLabel('Cost price (Rs)').fill('80');
  await page.getByLabel('Selling price (Rs)').fill('100');
  const out = page.getByRole('status').filter({ hasText: 'Markup (profit on cost)' });
  await expect(out).toContainText('25%');
  await expect(out).toContainText('20%');
  await page.getByLabel(/The price for a margin on the price/).check();
  await page.getByLabel('Margin on price (%)').fill('20');
  await expect(page.getByRole('status').filter({ hasText: 'Selling price' })).toContainText('100.00');
  await page.getByLabel('Margin on price (%)').fill('100');
  await expect(page.getByText('A margin of 100% or more is not possible.')).toBeVisible();

  await page.goto('/tools/emi-calculator');
  await page.getByLabel('Loan amount (Rs)').fill('10,00,000');
  await page.getByLabel('Interest rate (% a year)').fill('9');
  await page.getByLabel('Time', { exact: true }).fill('20');
  await expect(page.getByRole('status').filter({ hasText: 'a month for 240 months' })).toContainText('8,997.26');
  await expect(page.getByRole('row')).toHaveCount(13);   // header and the first twelve months
  await page.getByLabel('Time', { exact: true }).fill('0');
  await expect(page.getByText(/Check the amount, the rate/)).toBeVisible();

  await page.goto('/tools/interest-calculator');
  await page.getByLabel('Amount (Rs)').fill('100000');
  await page.getByLabel('Interest rate (% a year)').fill('8');
  await page.getByLabel('Time (years)').fill('3');
  await expect(page.getByRole('status').filter({ hasText: 'Total' })).toContainText('1,24,000.00');
  await page.getByLabel('Time is in').selectOption('days');
  await page.getByLabel('Amount (Rs)').fill('100000');
  await page.getByLabel('Interest rate (% a year)').fill('18');
  await page.getByLabel('Time (days)').fill('30');
  await expect(page.getByRole('status').filter({ hasText: 'Total' })).toContainText('1,01,479.45');
  await page.getByLabel('Time is in').selectOption('years');
  await page.getByRole('radio', { name: 'Compound' }).check();
  await page.getByLabel('Interest rate (% a year)').fill('12');
  await page.getByLabel('Time (years)').fill('1');
  await page.getByLabel('Compounded').selectOption('4');
  await expect(page.getByRole('status').filter({ hasText: 'Total' })).toContainText('1,12,550.88');
});

test('tool pages link their related tools in the text and have their own share card', async ({ page, request }) => {
  await page.goto('/tools/emi-calculator');
  await expect(page.locator('.vt-related a').first()).toHaveAttribute('href', /\/tools\//);
  const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(og).toContain('/tools/emi-calculator/opengraph-image');
  const res = await request.get(new URL(og!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});

test('each removed tool address redirects permanently to the tools hub', async ({ request }) => {
  for (const slug of REMOVED) {
    for (const path of [`/tools/${slug}`, `/tools/${slug}/opengraph-image`]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(308);
      expect(new URL(res.headers()['location']!, 'http://x').pathname, path).toBe('/tools');
    }
  }
  const hub = await request.get('/tools');
  expect(hub.status()).toBe(200);
});

test('every tool has a contextual Kora call to action that goes to sign-up', async ({ page }) => {
  for (const slug of ['gst-calculator', 'invoice-generator', 'interest-calculator', 'logo-maker', 'barcode-scanner']) {
    await page.goto(`/tools/${slug}`);
    const note = page.getByLabel('Do this automatically in Kora');
    await expect(note).toBeVisible();
    await expect(note.getByRole('link')).toHaveAttribute('href', '/login?signup=1');
  }
});

test('Logo maker: a big logo is fitted under 150 KB for Kora', async ({ page }) => {
  await page.goto('/tools/logo-maker');
  const big = await picture(page, 'image/jpeg', 1200, 1200, true);
  expect(big.length).toBeGreaterThan(300 * 1024);
  await page.getByLabel('Choose your logo').setInputFiles({ name: 'noisy.jpg', mimeType: 'image/jpeg', buffer: big });
  await expect(page.getByText(/Fits under 150 KB/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('img', { name: 'Your logo fitted for Kora' })).toBeVisible();
  const out = await saved(page, () => page.getByRole('button', { name: /^Download noisy-kora-logo\.jpg/ }).click());
  expect(isJpg(out.data)).toBe(true);
  expect(out.data.length).toBeLessThanOrEqual(150 * 1024);
  await page.getByLabel('Choose your logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('is not a JPG, PNG or WebP picture');
});
