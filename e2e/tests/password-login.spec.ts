import { expect, test } from '@playwright/test';

test('create an account with a password and no code, sign out, and sign in again', async ({ page }) => {
  const email = `pw${Date.now()}@example.test`;
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Meera Shah');
  await page.getByLabel('I am').selectOption('lawyer');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByLabel(/^Password/).fill('a good long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/setup/);                     // a new account has no business yet

  await page.request.post('/api/auth/logout', { data: {} });
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByLabel('Password').fill('not the right one');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p.error')).toContainText('not right');
  await page.getByLabel('Password').fill('a good long password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);
  const me = await (await page.request.get('/api/me')).json();
  expect(me.accountType).toBe('lawyer');
});

test('a second sign-up with the same address is refused in plain words', async ({ page }) => {
  const email = `dup${Date.now()}@example.test`;
  const body = { identifier: email, password: 'a good long password', name: 'A', accountType: 'business' };
  expect((await page.request.post('/api/auth/signup', { data: body })).status()).toBe(200);
  const again = await page.request.post('/api/auth/signup', { data: body });
  expect(again.status()).toBe(400);
  expect((await again.json()).error).toContain('already exists');
});
