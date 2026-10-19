import { expect, test } from '@playwright/test';
import { totpAt, totpStep } from '../../packages/core/src/totp.js';
import { db, makeBusiness, recoverOtp, signedIn, uniq } from '../helpers';

test('an authenticator app is set up, then every sign-in needs its code, and a recovery code works once', async ({ page, context, request }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/security');
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();

  await page.getByRole('button', { name: 'Set up' }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByLabel('The 6-digit code the app shows').fill('000000');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();
  await page.getByLabel('The 6-digit code the app shows').fill(totpAt(secret, totpStep()));
  await page.getByRole('button', { name: 'Turn on' }).click();
  const codes = (await page.getByTestId('recovery-codes').locator('pre').textContent())!.trim().split('\n');
  expect(codes).toHaveLength(10);
  await expect(page.getByText(/On\. You will be asked/)).toBeVisible();

  // signing in again, as a fresh browser, now stops after the first code
  const identifier = u.email;
  const startLogin = async () => {
    expect((await request.post('/api/auth/request', { data: { identifier } })).status()).toBe(200);
    await db`update otp_challenge set created_at = created_at - interval '1 minute' where identifier = ${identifier}`;
    const code = await recoverOtp(identifier);
    const v = await request.post('/api/auth/verify', { data: { identifier, code } });
    return { status: v.status(), body: await v.json(), cookie: v.headers()['set-cookie'] };
  };
  const first = await startLogin();
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ needsMfa: true });
  expect(first.cookie).toBeUndefined();
  expect((await request.get('/api/me')).status()).toBe(401);
  expect((await request.post('/api/auth/mfa', { data: { mfaToken: first.body.mfaToken, code: '123456' } })).status()).toBe(400);
  const ok = await request.post('/api/auth/mfa', { data: { mfaToken: first.body.mfaToken, code: totpAt(secret, totpStep() + 1) } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['set-cookie']).toContain('kora_session=');
  expect((await request.get('/api/me')).status()).toBe(200);

  // a recovery code works once
  const second = await startLogin();
  const rec = await request.post('/api/auth/mfa', { data: { mfaToken: second.body.mfaToken, code: codes[0] } });
  expect(rec.status()).toBe(200);
  const third = await startLogin();
  expect((await request.post('/api/auth/mfa', { data: { mfaToken: third.body.mfaToken, code: codes[0] } })).status()).toBe(400);

  // devices: the browser sees the new sessions and can end them
  await page.reload();
  await expect(page.getByRole('table', { name: 'Sessions' }).getByRole('row')).not.toHaveCount(2);
  await page.getByRole('button', { name: 'Sign out everywhere else' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Signed out \d+ other/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Sessions' }).getByRole('row')).toHaveCount(2);
  expect((await request.get('/api/me')).status()).toBe(401);
  await expect(page.getByText('Authenticator app turned on')).toBeVisible();
});

test('the login screen asks for the authenticator code as a second step', async ({ page, context, browser }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/security');
  await page.getByRole('button', { name: 'Set up' }).click();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByLabel('The 6-digit code the app shows').fill(totpAt(secret, totpStep()));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('/login');
  await p2.getByLabel('Mobile number or email').fill(u.email);
  await p2.getByRole('button', { name: 'Send code' }).click();
  await expect(p2.getByLabel(/Six-digit code sent to/)).toBeVisible();
  await db`update otp_challenge set created_at = created_at - interval '1 minute' where identifier = ${u.email}`;
  await p2.getByLabel(/Six-digit code sent to/).fill(await recoverOtp(u.email));
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2.getByLabel('Code from your authenticator app, or a recovery code')).toBeVisible();
  await p2.getByLabel('Code from your authenticator app, or a recovery code').fill(totpAt(secret, totpStep() + 1));
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2).toHaveURL(/\/setup|\/app/);
  await ctx2.close();
});

test('an account can be closed once it is not the only owner of anything, and the same number starts a fresh one', async ({ page, context }) => {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  await page.goto('/app/security');
  // the only owner of a business cannot close the account
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Close my account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'only owner of' })).toBeVisible();
  // with a second owner it can
  const [o2] = await db`insert into app_user (email) values (${`o2${uniq()}@example.test`}) returning id`;
  await db`insert into member (business_id, user_id, role) values (${b.businessId}, ${o2!.id}, 'owner')`;
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Close my account' }).click();
  await expect(page).toHaveURL(/\/$/);
  const [row] = await db`select phone, email, deleted_at from app_user where id = ${u.userId}`;
  expect(row).toMatchObject({ phone: null, email: null });
  expect(row!.deleted_at).not.toBeNull();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});
