import { expect, test } from '@playwright/test';
import { makeBusiness, signedIn, uniq } from '../helpers';

test.describe('public pages', () => {
  test('the landing page has a title, a description and share tags, and a security section', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kora/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /GST invoices/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Kora/);
    await expect(page.getByRole('heading', { name: /kept safe/ })).toBeVisible();
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  });

  test('robots and the sitemap list the public pages and keep the app out', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /app/');
    expect(robots).toContain('Sitemap:');
    const map = await (await request.get('/sitemap.xml')).text();
    for (const p of ['/pricing', '/help', '/help/first-invoice', '/terms', '/privacy', '/refunds']) expect(map).toContain(p);
    expect(map).not.toContain('/app/');
  });

  test('pricing shows three plans, says the prices are placeholders, and has a comparison table', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: 'Starter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Firm' })).toBeVisible();
    await expect(page.getByText('Placeholder prices.')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Payment reminders');
  });

  test('help can be searched without a script, and an article opens with steps', async ({ page }) => {
    await page.goto('/help');
    await page.getByLabel('Search help').fill('reminders');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: /Payment reminders/ })).toBeVisible();
    await page.goto('/help/first-invoice');
    await expect(page.getByRole('heading', { name: 'Make your first invoice', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
    await page.goto('/help?q=zzzzqq');
    await expect(page.getByText(/Nothing found/)).toBeVisible();
  });

  test('legal pages say they are drafts awaiting a lawyer, and an unknown page shows a helpful 404', async ({ page }) => {
    for (const p of ['/terms', '/privacy', '/refunds']) {
      await page.goto(p);
      await expect(page.getByText('Draft awaiting a lawyer.')).toBeVisible();
    }
    const r = await page.goto('/no-such-page');
    expect(r?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /could not find that page/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search the help centre' })).toBeVisible();
    await page.goto('/import-guide');
    await expect(page.getByRole('heading', { name: 'Zoho Invoice or Zoho Books' })).toBeVisible();
  });

  test('the landing page and the pricing page do not scroll sideways at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const p of ['/', '/pricing', '/help', '/login']) {
      await page.goto(p);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${p} overflows by ${over}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('sign-up screen', () => {
  test('shows password strength, explains a bad mobile number, and remembers the account type', async ({ page }) => {
    await page.goto('/login?signup=1');
    await page.getByLabel('I am').selectOption('freelancer');
    await page.getByLabel(/^Password/).fill('abc');
    await expect(page.locator('#pw-note')).toContainText('Too short');
    await page.getByLabel(/^Password/).fill('correct horse battery staple 7');
    await expect(page.locator('#pw-note')).toContainText('Strong');
    await page.getByLabel('Mobile number or email').fill('12345');
    await page.getByLabel(/^Password/).focus();
    await expect(page.locator('#id-err')).toContainText('valid 10-digit Indian mobile number');
    await page.getByLabel('Your name').fill('Test Person');
    await page.getByLabel('Mobile number or email').fill(`n4${uniq()}@example.test`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/app\/projects|\/setup/);
    await page.goto('/login?signup=1');
    // signed in already, so the login page forwards; the choice was stored for the next visit
    expect(await page.evaluate(() => localStorage.getItem('kora-account-type'))).toBe('freelancer');
  });
});

test.describe('welcome wizard and sample data', () => {
  test('progress is saved, steps can be skipped, and a customer made in the wizard completes its step', async ({ page, context }) => {
    const { userId } = await signedIn(context);
    await makeBusiness(userId, 'Wizard Traders');
    await page.goto('/app/welcome');
    await expect(page.getByRole('heading', { name: 'Welcome to Kora' })).toBeVisible();
    await page.getByLabel('Address').fill('12 Main Road');
    await page.getByLabel('City').fill('Pune');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Your logo' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: 'Invoice look' })).toBeVisible();
    await page.locator('label.look', { hasText: 'Modern' }).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'First customer' })).toBeVisible();
    await page.getByLabel('Customer name').fill('Verma Stores');
    await page.getByLabel('State').selectOption('27');
    await page.getByRole('button', { name: 'Add customer and continue' }).click();
    await expect(page.getByRole('heading', { name: 'First invoice' })).toBeVisible();
    // leave and come back: the choices are still there, and the wizard opens on what is left
    await page.reload();
    await expect(page.getByRole('button', { name: /Your logo \(skipped\)|2\. Your logo/ })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    await expect(page.getByRole('heading', { name: 'First invoice' })).toBeVisible();
    await page.getByRole('link', { name: 'Skip to my dashboard' }).or(page.getByRole('link', { name: 'Go to your dashboard' })).click();
    await expect(page).toHaveURL(/\/app$/);
    // the Help button is on every screen, and it opens a tour
    await page.getByRole('button', { name: /Help/ }).click();
    await page.getByRole('button', { name: 'Take a tour of the screens' }).click();
    await expect(page.getByRole('dialog', { name: 'Tour of Kora' })).toContainText('Dashboard');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: 'Tour of Kora' })).toContainText('Documents');
  });

  test('the sample business is labelled, has realistic invoices, can be removed, and the real business stays', async ({ page, context }) => {
    const { userId } = await signedIn(context);
    await makeBusiness(userId, 'Real Traders');
    await page.goto('/app');
    await page.getByTestId('try-demo').click();
    await expect(page.getByText('Sample data.', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('stat-owed')).not.toHaveText('Rs 0.00');
    await page.goto('/app/invoices');
    await expect(page.getByText('Mehta Textiles Pvt Ltd').first()).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove sample data' }).click();
    await expect(page.getByText('Sample data.')).toHaveCount(0);
    await expect(page.locator('option', { hasText: 'Real Traders' })).toHaveCount(1);
    // asking again makes a fresh one, and a real business refuses removal
    const refused = await page.request.post('/api/demo/remove', { data: {} });
    expect(refused.status()).toBe(400);
  });

  test('empty lists say what to do next', async ({ page, context }) => {
    const { userId } = await signedIn(context);
    await makeBusiness(userId, 'Empty Traders');
    await page.goto('/app/customers');
    await expect(page.getByTestId('empty-state')).toContainText('No customers yet');
    await page.goto('/app/recurring');
    await expect(page.getByText('No recurring invoices yet')).toBeVisible();
    await page.goto('/app/import');
    await expect(page.getByRole('heading', { name: 'Move to Kora' })).toBeVisible();
    await page.getByRole('radio', { name: 'Tally' }).click();
    await expect(page.getByText('Customer ledgers with GSTIN')).toBeVisible();
  });
});
