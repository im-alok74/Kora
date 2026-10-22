import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

async function twoDocuments(page: import('@playwright/test').Page) {
  await page.request.post('/api/parties', { data: { kind: 'customer', name: '=Formula Buyer', stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const mk = async (rate: string, issue: boolean) => {
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, dueDate: '2026-01-05', lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] } })).json();
    if (issue) await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  };
  return { issued: await mk('1000', true), draft: await mk('250', false) };
}

test('keyboard shortcuts move around the app, and stay out of the way while typing', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Keyboard shortcuts and help' }).click();           // the button opens it too
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page).toHaveURL(/\/app\/invoices$/);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/app\/customers$/);
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/app\/invoices\/new$/);

  // typing a letter in a field is never a shortcut
  await page.getByLabel('Order or PO number').fill('ng gn');
  await expect(page).toHaveURL(/\/app\/invoices\/new$/);
  await expect(page.getByLabel('Order or PO number')).toHaveValue('ng gn');
});

test('a list can hide columns, remember a view on this device, and export what it shows without running formulas', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await twoDocuments(page);
  await page.goto('/app/invoices');
  const table = page.getByRole('table').last();
  await expect(table).toContainText('=Formula Buyer');
  await expect(page.getByRole('columnheader', { name: 'Due' })).toBeVisible();

  await page.getByText('Columns', { exact: true }).click();
  await page.getByLabel('Due', { exact: true }).uncheck();
  await expect(page.getByRole('columnheader', { name: 'Due' })).toHaveCount(0);

  await page.getByLabel('Save this view as').fill('Without due');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved on this device' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Due' })).toBeVisible();                // back to the default
  await page.getByLabel('Saved views').selectOption('Without due');
  await expect(page.getByRole('columnheader', { name: 'Due' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Drafts' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);                                         // the header and the one draft
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(3);                                         // the header and both documents again

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^documents-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'));
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('Number,Type,Customer,Date,Due,Total,Balance,Status');
  expect(text).toContain("'=Formula Buyer");                                                   // quoted so a spreadsheet cannot run it
  expect(text).not.toMatch(/,=Formula/);
  expect(text).toContain('1000.00');
});

test('customers and items export too', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Export Me', stateCode: '27', phone: '9876543210' } });
  await page.request.post('/api/items', { data: { name: 'Widget', kind: 'goods', hsnSac: '8479', defaultRateBp: 1800, price: '99.50', unit: 'NOS' } });
  await page.goto('/app/customers');
  let [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(d.suggestedFilename()).toBe('customers.csv');
  expect(await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8')).toContain('Export Me');
  await page.goto('/app/items');
  [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const items = await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8');
  expect(items).toContain('Widget');
  expect(items).toContain('99.50');
});

test('team notes on an invoice can be added and removed', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Notes Buyer', desc: 'Item', rate: '100' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  await page.getByLabel('Add a note').fill('Customer promised to pay on Friday.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Customer promised to pay on Friday.')).toBeVisible();
  await expect(page.getByText(new RegExp(u.email.split('@')[0]!))).toBeVisible();
  await page.reload();
  await expect(page.getByText('Customer promised to pay on Friday.')).toBeVisible();
  await page.getByRole('button', { name: /Remove the note by/ }).click();
  await expect(page.getByText('Customer promised to pay on Friday.')).toHaveCount(0);
});
