import { expect, test } from '@playwright/test';
import { gstin, recoverOtp } from '../helpers';

test('a new user signs up, issues an invoice and sends it on WhatsApp in under 60 seconds', async ({ page }) => {
  const phone = `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
  const started = Date.now();
  let steps = 0;
  const step = () => { steps++; };

  await page.goto('/login');
  await page.getByRole('button', { name: 'Use an emailed or texted code' }).click();
  await page.getByLabel('Mobile number or email').fill(phone); step();
  await page.getByRole('button', { name: 'Send code' }).click(); step();
  await expect(page.getByLabel(/Six-digit code/)).toBeVisible();   // the server has stored the code by now
  const code = await recoverOtp(`+91${phone}`);
  await page.getByLabel(/Six-digit code/).fill(code); step();
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click(); step();

  await expect(page.getByRole('heading', { name: 'Set up your business', exact: true })).toBeVisible();
  await page.getByLabel('Legal name of the business').fill('Sharma Traders'); step();
  await page.getByLabel('GSTIN').fill(gstin('27')); step();
  await page.getByRole('button', { name: 'Create business' }).click(); step();

  await expect(page.getByRole('heading', { name: 'Welcome to Kora', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Skip setup and make an invoice now' }).click(); step();
  await expect(page.getByRole('heading', { name: /New tax invoice/ })).toBeVisible();
  await page.getByLabel('Customer', { exact: true }).selectOption('__new'); step();
  await page.getByLabel('Customer name').fill('Verma Stores'); step();
  await page.getByLabel('State', { exact: true }).selectOption('27'); step();
  await page.getByRole('button', { name: 'Add customer' }).click(); step();
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Verma Stores' });
  await page.getByLabel('Line 1 description').fill('Consulting'); step();
  await page.getByLabel('Line 1 HSN or SAC').fill('998313'); step();
  await page.getByLabel('Line 1 rate').fill('10000'); step();
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 11,800.00');
  await page.getByRole('button', { name: 'Issue tax invoice' }).click(); step();

  await expect(page.getByRole('heading', { name: /Tax invoice INV\/\d\d-\d\d\/0001/ })).toBeVisible();
  await page.getByLabel('Mobile number').fill('98765 43210'); step();
  await page.getByRole('button', { name: 'Send', exact: true }).click(); step();
  await expect(page.getByText('Sent by whatsapp.')).toBeVisible();

  const seconds = (Date.now() - started) / 1000;
  console.log(`first invoice sent in ${seconds.toFixed(1)}s, ${steps} user actions (includes ~1s to recover the code the test cannot read)`);
  expect(seconds).toBeLessThan(60);
});

test('login rejects a wrong code and shows the message', async ({ page }) => {
  const phone = `8${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use an emailed or texted code' }).click();
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel(/Six-digit code/).fill('000000');
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('not right or has expired');
});

test('a bad mobile number is refused before any code is sent', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use an emailed or texted code' }).click();
  await page.getByLabel('Mobile number or email').fill('12345');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('valid 10-digit Indian mobile number');
});

test('setup refuses a GSTIN with a wrong check character', async ({ page, context }) => {
  const { signedIn } = await import('../helpers');
  await signedIn(context);
  await page.goto('/setup');
  await page.getByLabel('Legal name of the business').fill('Bad Gstin Co');
  const g = gstin('27');
  const bad = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A');
  await page.getByLabel('GSTIN').fill(bad);
  await expect(page.getByText('This GSTIN is not valid')).toBeVisible();
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('GSTIN is not valid');
});

test('the home page explains the product and leads to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('GST invoicing');
  await expect(page.getByRole('heading', { name: /From first login to first payment/ })).toBeVisible();
  await page.getByRole('link', { name: /^Sign in/ }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Kora', exact: true })).toBeVisible();
});
