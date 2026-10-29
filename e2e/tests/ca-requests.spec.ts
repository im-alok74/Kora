import { expect, test } from '@playwright/test';
import { gstin, signedIn } from '../helpers';

test('a CA asks a client for documents, the client sends one from a link with no account, and the CA sees it', async ({ page, context, browser }) => {
  await signedIn(context);
  await page.goto('/ca');
  await page.getByLabel('Firm name').fill('Mehta and Co');
  await page.getByRole('button', { name: 'Create firm' }).click();
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible();

  await page.goto('/ca/clients');
  await page.getByLabel('Client name').fill('Alpha Foods');
  await page.getByLabel('GSTIN').fill(gstin('27'));
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('table', { name: 'Clients' })).toContainText('Alpha Foods');

  await page.goto('/ca');
  await page.getByLabel('Month worked on').fill('2026-08');
  await page.getByRole('button', { name: 'Create 2026-08 work' }).click();
  await expect(page.getByRole('status')).toContainText('2 added');
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await page.getByRole('button', { name: 'Add the standard list' }).click();
  await expect(page.getByText('Bank statement for the month')).toBeVisible();
  await page.getByRole('button', { name: 'Make a link for the client' }).click();
  const url = await page.getByLabel('Link for the client').inputValue();
  expect(url).toMatch(/\/send\/[\w-]{20,}$/);

  // The client: a fresh browser with no sign-in.
  const client = await browser.newContext();
  const c = await client.newPage();
  await c.goto(url);
  await expect(c.getByRole('heading', { name: 'Documents for Mehta and Co' })).toBeVisible();
  await expect(c.getByText('Alpha Foods')).toBeVisible();
  const bank = c.locator('.panel', { hasText: 'Bank statement for the month' });
  await bank.locator('input[type=file]').setInputFiles({ name: 'bank.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 bank') });
  await expect(c.getByRole('status')).toContainText('Sent: Bank statement for the month');
  await expect(bank).toContainText('Received, thank you');
  await bank.locator('input[type=file]').setInputFiles({ name: 'virus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not a pdf') });
  await expect(c.locator('p.error')).toContainText('real file');
  await client.close();

  // The CA sees it, and can download exactly what was sent.
  await page.reload();
  await page.getByLabel('Month worked on').fill('2026-08');
  await page.getByRole('button', { name: 'Documents' }).first().click();
  const row = page.getByText('Bank statement for the month').locator('..');
  await expect(row).toContainText('Received');
  const href = await row.getByRole('link', { name: 'bank.pdf' }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('attachment');
  expect(await res.text()).toBe('%PDF-1.4 bank');

  // Sending it back with a reason: the client sees the reason and the item asks again.
  await row.getByRole('button', { name: 'Send back' }).click();
  await page.getByLabel('What is wrong? The client will see this.').fill('Page 2 is missing');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Sent back');
  const back = await browser.newContext();
  const b = await back.newPage();
  await b.goto(url);
  const again1 = b.locator('.panel', { hasText: 'Bank statement for the month' });
  await expect(again1).toContainText('Please send again');
  await expect(again1).toContainText('Page 2 is missing');
  await back.close();

  // Stopping the link closes the door.
  await page.getByRole('button', { name: 'Stop the link' }).click();
  const again = await browser.newContext();
  const a = await again.newPage();
  await a.goto(url);
  await expect(a.getByRole('heading', { name: 'This link is not valid any more' })).toBeVisible();
  await again.close();
});
