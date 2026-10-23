import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { TOOLS } from '../../apps/web/lib/tools';

const serious = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target?.join(' ')}`);
const setTheme = async (page: Page, theme: 'light' | 'dark') => { await page.addInitScript((t) => localStorage.setItem('kora-theme', t), theme); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); };

test('sign-in: split layout on a desktop, one column on a phone, password toggle inside the field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to Kora' })).toBeVisible();
  await expect(page.getByLabel('About Kora')).toBeVisible();
  const pw = page.getByLabel('Password', { exact: true });
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(pw).toHaveAttribute('type', 'text');
  const [f, b] = await Promise.all([pw.boundingBox(), page.getByRole('button', { name: 'Hide' }).boundingBox()]);
  expect(b!.x).toBeGreaterThan(f!.x + f!.width / 2);              // the toggle sits inside the field, at its right
  expect(b!.y).toBeGreaterThanOrEqual(f!.y); expect(b!.y + b!.height).toBeLessThanOrEqual(f!.y + f!.height + 1);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByLabel('About Kora')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('create-account mode opens from the link and has the strength note and no stray toggle', async ({ page }) => {
  await page.goto('/login?signup=1');
  await expect(page.getByRole('heading', { name: 'Create your Kora account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show' })).toHaveCount(1);
  await page.getByLabel(/^Password/).fill('abc');
  await expect(page.locator('#pw-note')).not.toBeEmpty();
});

test('the 404 page keeps the site header and offers ways out', async ({ page }) => {
  const r = await page.goto('/no-such-page-here');
  expect(r?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
});

test('the header Tools menu opens on hover and from the keyboard, and tablets get the compact menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/pricing');
  const pop = page.getByRole('group', { name: 'Free tools' });
  await expect(pop).toBeHidden();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Tools' }).hover();
  await expect(pop).toBeVisible();
  await page.mouse.move(5, 400);
  await expect(pop).toBeHidden();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Tools' }).focus();
  await expect(pop).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await page.getByLabel('Navigation menu').click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Free tools' })).toBeVisible();
});

test('the footer shows the brand and three link columns on one row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/pricing');
  const ys = await Promise.all(['Product', 'Help', 'Legal'].map(async (n) => (await page.locator('footer').getByRole('navigation', { name: n }).boundingBox())!.y));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
});

test('every tool page has structured data, a canonical link and its own copy', async ({ page }) => {
  for (const t of TOOLS) {
    await page.goto(`/tools/${t.slug}`);
    const types = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? '{}')['@type']));
    expect(types, t.slug).toEqual(expect.arrayContaining(['SoftwareApplication', 'FAQPage', 'BreadcrumbList']));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tools/${t.slug}$`));
    expect(await page.locator('.vt-faq details').count(), `${t.slug} faq`).toBeGreaterThanOrEqual(5);   // the generic copy only has three
  }
});

test('the document makers offer the current GST rates', async ({ page }) => {
  await page.goto('/tools/quotation-maker');
  const rates = await page.getByLabel('GST %').first().locator('option').allTextContents();
  expect(rates).toEqual(['0%', '3%', '5%', '18%', '40%']);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing serious on the public pages and every tool, ${theme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await setTheme(page, theme);
    for (const p of ['/', '/pricing', '/help', '/download', '/import-guide', '/terms', '/privacy', '/refunds', '/tools', '/login', '/login?signup=1', ...TOOLS.map((t) => `/tools/${t.slug}`)]) {
      await page.goto(p);
      await page.waitForSelector('h1');
      await page.waitForTimeout(400);
      expect(await serious(page), `${p} ${theme}`).toEqual([]);
    }
  });
}
