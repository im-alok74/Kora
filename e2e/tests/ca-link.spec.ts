import { expect, test } from '@playwright/test';
import { gstin, makeBusiness, signedIn } from '../helpers';

test('a CA links a client\'s Kora books with the owner\'s code, reads them, and the owner can stop it', async ({ page, context, browser }) => {
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

  // The client's owner, with a real Kora business, in another browser.
  const octx = await browser.newContext();
  const owner = await signedIn(octx);
  await makeBusiness(owner.userId, 'Alpha Foods Pvt Ltd');

  await page.getByRole('button', { name: /Show whether this client's Kora books are linked/ }).click();
  await expect(page.getByText('Not linked.')).toBeVisible();
  await page.getByRole('button', { name: 'Ask to link' }).click();
  const code = (await page.getByRole('status').locator('b').first().innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

  // Until the owner agrees, the firm can read nothing.
  await expect(page.getByText('Waiting for their owner').or(page.getByText(code))).toBeVisible();

  const o = await octx.newPage();
  await o.goto('/app/firms');
  await expect(o.getByRole('heading', { name: 'Accounting firms' })).toBeVisible();
  await o.getByLabel('Code from your accounting firm').fill('WRONG-CODES');
  await o.getByRole('button', { name: 'Allow the firm' }).click();
  await expect(o.locator('p.error')).toContainText('not valid');
  await o.getByLabel('Code from your accounting firm').fill(code.toLowerCase());
  await o.getByRole('button', { name: 'Allow the firm' }).click();
  await expect(o.getByRole('status')).toContainText('only read');
  await expect(o.getByRole('table', { name: 'Firms with access' })).toContainText('Mehta and Co');

  await page.reload();
  await page.getByRole('button', { name: /Show whether this client's Kora books are linked/ }).click();
  await expect(page.getByText('Linked', { exact: true })).toBeVisible();
  await expect(page.getByText(/Owed to them/)).toBeVisible();
  await expect(page.getByText(/No GSTR-2B for/)).toBeVisible();

  // The owner stops it; the firm can read nothing more.
  o.on('dialog', (d) => d.accept());
  await o.getByRole('button', { name: 'Stop access' }).click();
  await expect(o.getByRole('heading', { name: 'No firm can read this business' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Show whether this client's Kora books are linked/ }).click();
  await expect(page.getByText('Not linked.')).toBeVisible();
  await octx.close();
});
