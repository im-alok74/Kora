import { expect, test } from '@playwright/test';
import { gstin, signedIn } from '../helpers';

test('a CA sets up a firm, adds a client, creates the month, and records what is holding a return up', async ({ page, context }) => {
  await signedIn(context);
  await page.goto('/ca');
  await expect(page.getByRole('heading', { name: 'Set up your firm' })).toBeVisible();
  await page.getByLabel('Firm name').fill('Sharma and Co');
  await page.getByRole('button', { name: 'Create firm' }).click();
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible(); // the page reloads once the firm exists

  await page.goto('/ca/clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await page.getByLabel('Client name').fill('Alpha Foods');
  await page.getByLabel('GSTIN').fill(gstin('27'));
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('table', { name: 'Clients' })).toContainText('Alpha Foods');
  await page.getByLabel('Client name').fill('Bad Co');
  await page.getByLabel('GSTIN').fill('27AAAAA0000A1Z5');
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.locator('p.error')).toContainText('not valid');

  await page.goto('/ca');
  await page.getByLabel('Month worked on').fill('2026-08');
  await page.getByRole('button', { name: 'Create 2026-08 work' }).click();
  await expect(page.getByRole('status')).toContainText('2 added');
  const table = page.getByRole('table', { name: 'Work' });
  await expect(table).toContainText('GSTR-1');
  await expect(table).toContainText('2026-09-11');
  await expect(table).toContainText('GSTR-3B');

  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.getByLabel('What is holding it up').fill('Bank statement missing');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('ca-blocked')).toHaveText('1');
  await expect(table).toContainText('Waiting on the client');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('ca-blocked')).toHaveText('0');

  await page.getByLabel('Status of GSTR-1 for Alpha Foods').selectOption('preparing');
  await page.reload();
  await expect(page.getByLabel('Month worked on')).toBeVisible();
  await page.getByLabel('Month worked on').fill('2026-08');
  await expect(page.getByLabel('Status of GSTR-1 for Alpha Foods')).toHaveValue('preparing');
});
