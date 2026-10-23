import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The PDF, picture and text tools. Every input is made inside the test, so nothing depends on files from outside.
const NEW_TOOLS = ['pdf-to-image', 'image-converter', 'image-compressor', 'images-to-pdf', 'merge-split-pdf', 'gstin-validator', 'amount-in-words', 'word-counter'];

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) { const p = d.addPage([300, 400]); p.drawText(`Page ${i + 1}`, { x: 60, y: 200, size: 40 }); }
  return Buffer.from(await d.save());
}

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

const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b: Buffer) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
const isZip = (b: Buffer) => b.subarray(0, 2).toString() === 'PK';
const zipEntries = (b: Buffer) => { let n = 0; for (let i = 0; i + 4 <= b.length; i++) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x03 && b[i + 3] === 0x04) n++; return n; };

async function saved(page: Page, click: () => Promise<void>): Promise<{ name: string; data: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), data: readFileSync(path) };
}

const png = (name = 'pic.png', data?: Buffer) => ({ name, mimeType: 'image/png', buffer: data! });

test('the hub and the sitemap list every new tool', async ({ page, request }) => {
  await page.goto('/tools');
  for (const t of ['PDF to Image Converter', 'Image Converter', 'Image Compressor and Resizer', 'Images to PDF', 'Merge and Split PDF', 'GSTIN Validator', 'Amount in Words', 'Word Counter and Keyword Density']) {
    await expect(page.locator('#all-tools').getByRole('link', { name: new RegExp(`^${t}`) })).toBeVisible();
  }
  for (const g of ['PDF and images', 'Text and numbers']) await expect(page.getByRole('heading', { name: g })).toBeVisible();
  const map = await (await request.get('/sitemap.xml')).text();
  for (const s of NEW_TOOLS) expect(map).toContain(`/tools/${s}`);
});

test('the Tools menu in the header groups the tools and works from the keyboard', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /^Tools/ });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const pop = page.locator('.k-menu-pop');
  await expect(pop.getByRole('link', { name: 'GSTIN Validator' })).toBeVisible();
  await expect(pop.getByRole('group', { name: 'PDF and images' })).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();   // a tap opens it too
  await expect(pop).toBeVisible();
});

test('PDF to image: pages become pictures, a range works, a ZIP downloads, and bad files are explained', async ({ page }) => {
  await page.goto('/tools/pdf-to-image');
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: await pdf(3) });
  await expect(page.getByText('3 pages')).toBeVisible();
  await page.getByRole('button', { name: /^Convert to PNG/ }).click();
  await expect(page.getByRole('img', { name: 'Page 3 as a picture' })).toBeVisible();
  await expect(page.getByText('3 pictures ready.')).toBeVisible();
  const zip = await saved(page, () => page.getByRole('button', { name: /Download all as ZIP/ }).click());
  expect(zip.name).toBe('sample-pages.zip');
  expect(isZip(zip.data)).toBe(true);
  expect(zipEntries(zip.data)).toBe(3);
  const one = await saved(page, () => page.getByRole('link', { name: 'Download page 2' }).click());
  expect(isPng(one.data)).toBe(true);
  // a range, as JPG
  await page.getByLabel('Pages (leave empty for all)').fill('2');
  await page.getByLabel('JPG (smaller)').check();
  await page.getByRole('button', { name: /^Convert to JPG/ }).click();
  await expect(page.getByText('1 picture ready.')).toBeVisible();
  const jpg = await saved(page, () => page.getByRole('button', { name: 'Download the picture' }).click());
  expect(isJpg(jpg.data)).toBe(true);
  expect(jpg.name).toBe('sample-page-2.jpg');
  await page.getByLabel('Pages (leave empty for all)').fill('9');
  await page.getByRole('button', { name: /^Convert to JPG/ }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('goes past the end');
  // wrong type and damaged file
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('is not a PDF');
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really') });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('could not be read');
});

test('PDF to image: a password protected PDF asks for its password', async ({ page }) => {
  await page.goto('/tools/pdf-to-image');
  const locked = readFileSync(fileURLToPath(new URL('../fixtures/locked.pdf', import.meta.url)));
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: locked });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('password protected');
  await page.getByLabel(/Password for locked.pdf/).fill('wrong');
  await page.getByRole('button', { name: 'Unlock the PDF' }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('did not open');
  await page.getByLabel(/Password for locked.pdf/).fill('kora123');
  await page.getByRole('button', { name: 'Unlock the PDF' }).click();
  await expect(page.getByText('1 page', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Convert to PNG/ }).click();
  await expect(page.getByRole('img', { name: 'Page 1 as a picture' })).toBeVisible();
});

test('Image converter: JPG, PNG and WebP to each other, one at a time and in a batch', async ({ page }) => {
  await page.goto('/tools/image-converter');
  const p = await picture(page, 'image/png', 300, 200);
  const j = await picture(page, 'image/jpeg', 300, 200);
  await page.getByLabel('Choose pictures').setInputFiles([png('logo.png', p), { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: j }]);
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.getByRole('button', { name: /Convert 2 pictures/ }).click();
  await expect(page.getByText('2 pictures converted.')).toBeVisible();
  const web = await saved(page, () => page.getByRole('link', { name: 'Download logo.webp' }).click());
  expect(isWebp(web.data)).toBe(true);
  const zip = await saved(page, () => page.getByRole('button', { name: 'Download all as ZIP' }).click());
  expect(isZip(zip.data) && zipEntries(zip.data) === 2).toBe(true);
  await page.getByRole('radio', { name: 'JPG' }).click();
  await page.getByRole('button', { name: /Convert 2 pictures/ }).click();
  await expect(page.getByText(/Transparent areas became white/)).toBeVisible();
  const jpg = await saved(page, () => page.getByRole('link', { name: 'Download logo.jpg' }).click());
  expect(isJpg(jpg.data)).toBe(true);
  await page.getByRole('radio', { name: 'PNG' }).click();
  await page.getByRole('button', { name: /Convert 2 pictures/ }).click();
  const back = await saved(page, () => page.getByRole('link', { name: 'Download photo.png' }).click());
  expect(isPng(back.data)).toBe(true);
  // a wrong file is named and does not stop the rest
  await page.getByLabel('Choose pictures').setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('doc.pdf is not a JPG, PNG or WebP picture');
  await page.getByLabel('Choose pictures').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a picture at all') });
  await page.getByRole('button', { name: /Convert 3 pictures/ }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('bad.png');
  await expect(page.getByRole('link', { name: 'Download logo.png' })).toBeVisible();
});

test('Image compressor: the Kora logo button brings a big picture under 150 KB, and dimensions work', async ({ page }) => {
  await page.goto('/tools/image-compressor');
  const big = await picture(page, 'image/jpeg', 1200, 1200, true);
  expect(big.length).toBeGreaterThan(300 * 1024);
  await page.getByLabel('Choose a picture').setInputFiles({ name: 'noisy.jpg', mimeType: 'image/jpeg', buffer: big });
  await page.getByRole('button', { name: 'Kora invoice logo (under 150 KB)' }).click();
  await expect(page.getByText(/Fits under 150 KB/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('img', { name: 'Original picture' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Smaller picture' })).toBeVisible();
  const out = await saved(page, () => page.getByRole('button', { name: /^Download noisy-small\.jpg/ }).click());
  expect(isJpg(out.data)).toBe(true);
  expect(out.data.length).toBeLessThanOrEqual(150 * 1024);
  // dimensions
  await page.getByLabel('Width and height').check();
  await page.getByLabel('Width (px)').fill('300');
  await expect(page.getByLabel('Height (px)')).toHaveValue('300');
  await page.getByRole('button', { name: 'Make it smaller' }).click();
  await expect(page.getByText(/now 300 x 300/)).toBeVisible();
  // a limit nothing can meet is reported, not hidden
  await page.getByLabel('Target file size').check();
  await page.getByLabel('Largest file size (KB)').fill('5');
  await page.getByRole('button', { name: 'Make it smaller' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Could not reach 5 KB|Fits under 5 KB/ })).toBeVisible({ timeout: 60_000 });
});

test('Images to PDF: pictures become pages in the order chosen', async ({ page }) => {
  await page.goto('/tools/images-to-pdf');
  const wide = await picture(page, 'image/png', 400, 200);
  const tall = await picture(page, 'image/jpeg', 200, 400);
  await page.getByLabel('Choose pictures').setInputFiles([png('wide.png', wide), { name: 'tall.jpg', mimeType: 'image/jpeg', buffer: tall }]);
  await page.getByRole('button', { name: 'Move tall.jpg up' }).click();
  await expect(page.getByRole('list', { name: 'Pages, in order' }).getByRole('listitem').first()).toContainText('tall.jpg');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await expect(page.getByText('2 pages')).toBeVisible();
  const out = await saved(page, () => page.getByRole('button', { name: 'Download pictures.pdf' }).click());
  expect(out.data.subarray(0, 5).toString()).toBe('%PDF-');
  const doc = await PDFDocument.load(out.data);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);  // tall picture: portrait A4
  expect(doc.getPage(1).getWidth()).toBeCloseTo(841.89, 0);  // wide picture: landscape A4
  await page.getByLabel('Page size').selectOption('fit');
  await page.getByLabel('Margin').selectOption('0');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  const fit = await saved(page, () => page.getByRole('button', { name: 'Download pictures.pdf' }).click());
  const d2 = await PDFDocument.load(fit.data);
  expect([d2.getPage(0).getWidth(), d2.getPage(0).getHeight()]).toEqual([200, 400]);
});

test('Merge and split PDF: merge, extract, split into a ZIP, rotate, and refuse bad files', async ({ page }) => {
  await page.goto('/tools/merge-split-pdf');
  await page.getByLabel('Choose PDFs to join').setInputFiles([{ name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdf(2) }, { name: 'b.pdf', mimeType: 'application/pdf', buffer: await pdf(3) }]);
  await expect(page.getByText('1. a.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Move b.pdf up' }).click();
  await page.getByRole('button', { name: 'Merge the PDFs' }).click();
  const merged = await saved(page, () => page.getByRole('button', { name: 'Download merged.pdf' }).click());
  const md = await PDFDocument.load(merged.data);
  expect(md.getPageCount()).toBe(5);
  // split mode
  await page.getByRole('radio', { name: 'Split or extract' }).click();
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'five.pdf', mimeType: 'application/pdf', buffer: Buffer.from(merged.data) });
  await expect(page.getByText('5 pages').first()).toBeVisible();
  await page.getByLabel('Pages', { exact: true }).fill('4-5, 1');
  await page.getByRole('button', { name: 'Extract the pages' }).click();
  const ex = await saved(page, () => page.getByRole('button', { name: 'Download five-extract.pdf' }).click());
  expect((await PDFDocument.load(ex.data)).getPageCount()).toBe(3);
  await page.getByLabel('One PDF for every page').check();
  await page.getByRole('button', { name: 'Split the PDF' }).click();
  const zip = await saved(page, () => page.getByRole('button', { name: 'Download all as ZIP' }).click());
  expect(isZip(zip.data) && zipEntries(zip.data) === 5).toBe(true);
  await page.getByLabel('Pages', { exact: false }).first().isVisible();
  // rotate
  await page.getByRole('radio', { name: 'Rotate pages' }).click();
  await page.getByLabel('Pages to turn (leave empty for all)').fill('1');
  await page.getByRole('button', { name: 'Rotate and save' }).click();
  const rot = await saved(page, () => page.getByRole('button', { name: 'Download five-rotated.pdf' }).click());
  const rd = await PDFDocument.load(rot.data);
  expect(rd.getPage(0).getRotation().angle).toBe(90);
  expect(rd.getPage(1).getRotation().angle).toBe(0);
  // bad files are named
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('nope') });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('broken.pdf could not be read');
  const locked = readFileSync(fileURLToPath(new URL('../fixtures/locked.pdf', import.meta.url)));
  await page.getByLabel('Choose a PDF').setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: locked });
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('locked.pdf is password protected');
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

test('Word counter: counts, reading time, keywords and phrases', async ({ page }) => {
  await page.goto('/tools/word-counter');
  await page.getByLabel('Your text').fill('Cotton kurta for men. Soft cotton kurta, made in India. Buy the cotton kurta online!');
  await expect(page.locator('.tl-stats div').filter({ hasText: 'Words' }).first()).toContainText('15');
  await expect(page.locator('.tl-stats div').filter({ hasText: 'Sentences' })).toContainText('3');
  const kw = page.locator('.tl-kw').filter({ hasText: 'Top keywords' });
  await expect(kw.getByRole('row').nth(1)).toContainText('cotton');
  await expect(kw.getByRole('row').nth(1)).toContainText('20%');
  await expect(page.locator('.tl-kw').filter({ hasText: 'Two-word phrases' }).getByRole('row').nth(1)).toContainText('cotton kurta');
  await expect(kw).not.toContainText('the');
  await page.getByLabel(/Skip common words/).uncheck();
  await expect(kw.getByRole('cell', { name: 'for', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.tl-stats div').filter({ hasText: 'Words' }).first()).toContainText('0');
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
