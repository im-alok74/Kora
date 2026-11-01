import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { db, fillInvoice, makeBusiness, signedIn, uniq } from '../helpers';

// Launch audit fixes (U-1 to U-8): page titles, no sideways scrolling on a phone, keyboard reachable tables,
// the whole document in the phone preview, a visible read-only notice for the accountant, a way back from a forgotten password.
const SCREENS: [string, string][] = [['/app', 'Dashboard'], ['/app/invoices', 'Documents'], ['/app/customers', 'Customers'], ['/app/items', 'Items'], ['/app/reports', 'Reports'],
  ['/app/settings', 'Settings'], ['/app/data', 'Your data'], ['/app/security', 'Security'], ['/app/itc', 'Input GST'], ['/app/bank', 'Bank statement']];

test('every signed-in screen has its own page title', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const u = await signedIn(ctx);
  await makeBusiness(u.userId);
  const page = await ctx.newPage();
  for (const [path, name] of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page).toHaveTitle(`${name} | Kora`);
  }
  await ctx.close();
});

test('no signed-in screen scrolls sideways on a phone, and scrolling tables can be reached by keyboard', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const u = await signedIn(ctx);
  await makeBusiness(u.userId);
  const page = await ctx.newPage();
  const bad: string[] = [];
  for (const [path] of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForTimeout(300);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) bad.push(`${path} is ${w}px wide`);
    const axe = await new AxeBuilder({ page }).exclude('iframe').withRules(['scrollable-region-focusable']).analyze();
    if (axe.violations.length) bad.push(`${path}: scrollable-region-focusable`);
  }
  expect(bad).toEqual([]);
  await ctx.close();
});

test('the template download links are big enough to hit (WCAG 2.2 target size)', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const u = await signedIn(ctx);
  await makeBusiness(u.userId);
  const page = await ctx.newPage();
  for (const path of ['/app/data', '/app/import']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    const res = await new AxeBuilder({ page }).exclude('iframe').withRules(['target-size']).analyze();
    expect(res.violations.map((v) => `${path} ${v.id}`)).toEqual([]);
  }
  await ctx.close();
});

test('an invoice preview fits a phone screen and shows the whole page', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const u = await signedIn(ctx);
  await makeBusiness(u.userId);
  const page = await ctx.newPage();
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Verma Stores', rate: '10000' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const frame = page.getByTitle('Document preview');
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);   // scaled down, not cut off
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('the accountant is told the business is view only', async ({ browser }) => {
  const owner = await signedIn(await browser.newContext());
  const { businessId } = await makeBusiness(owner.userId);
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const acc = await signedIn(ctx);
  await db`insert into member (business_id, user_id, role) values (${businessId}, ${acc.userId}, 'accountant')`;
  const page = await ctx.newPage();
  await page.goto('/app');
  await expect(page.getByRole('note').filter({ hasText: 'View only' })).toBeVisible();
  const ctx2 = await browser.newContext({ reducedMotion: 'reduce' });
  const own = await signedIn(ctx2, `o${uniq()}@example.test`);
  await makeBusiness(own.userId);
  const p2 = await ctx2.newPage();
  await p2.goto('/app');
  await expect(p2.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(p2.getByText('View only')).toHaveCount(0);
  await ctx.close(); await ctx2.close();
});

test('someone who forgot the password is offered the code route by name', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
});
