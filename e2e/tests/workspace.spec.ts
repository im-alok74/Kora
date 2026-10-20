import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

async function draft(page: import('@playwright/test').Page, customer: string, rate: string) {
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer, rate });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
}

test('search opens with the keyboard, finds a customer and a document, and goes there', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await draft(page, 'Zebra Traders', '1000');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search' });
  await expect(box).toBeFocused();
  await expect(page.getByRole('option', { name: /New invoice/ })).toBeVisible();     // quick actions before typing
  await box.fill('zebra');
  await expect(page.getByRole('option', { name: /Zebra Traders/ }).first()).toBeVisible();
  await expect(page.getByText('Customers and vendors')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('zebra');
  await page.getByRole('option', { name: /Zebra Traders/ }).first().waitFor();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/(customers|invoices)\//);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('qqqqzzzz');
  await expect(page.getByText(/Nothing found for/)).toBeVisible();
});

test('the bell lists what needs attention, and a dismissed notice stays dismissed', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await draft(page, 'Late Payer', '500');
  const id = page.url().split('/').pop()!;
  expect((await page.request.post(`/api/documents/${id}/issue`, { data: {} })).ok()).toBe(true);
  await page.goto('/app');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  await expect(panel).toBeVisible();
  // the new business is regular, so a GST due date or two may show; there must be a way to dismiss each
  const first = panel.getByRole('listitem').first();
  const title = (await first.locator('b').textContent())!;
  await first.getByRole('button', { name: /^Dismiss:/ }).click();
  await expect(panel.getByText(title, { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText(title, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show dismissed' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText(title, { exact: true })).toBeVisible();
});

test('the dark theme can be switched on, is remembered, and is applied before the page paints', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to the light theme' })).toHaveAttribute('aria-pressed', 'true');
  // The dark background is whatever the theme's own colour is, so a change of palette does not need this test changed.
  const { bg, want } = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg');
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { bg: getComputedStyle(document.body).backgroundColor, want };
  });
  expect(bg).toBe(want);
  expect(bg).not.toBe('rgb(247, 245, 240)');                                         // and it is not the light page colour
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to the light theme' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
});

test('documents can be sorted, selected and issued together, and a customer has a page of their own', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await draft(page, 'Bulk Buyer', '100');
  await draft(page, 'Another Buyer', '300');
  await page.goto('/app/invoices');
  const rows = page.getByRole('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(2);

  // sort by total: ascending then descending
  await page.getByRole('button', { name: /^Total/ }).click();
  await expect(rows.first()).toContainText('Rs 118.00');
  await page.getByRole('button', { name: /^Total/ }).click();
  await expect(rows.first()).toContainText('Rs 354.00');

  // select both and issue them
  await page.getByLabel('Select all documents').check();
  await expect(page.getByRole('region', { name: 'Actions for the selected documents' })).toContainText('2 selected');
  await page.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 done.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /INV\// })).toHaveCount(2);

  // the customer page: totals and documents
  await page.goto('/app/customers');
  await page.getByRole('link', { name: 'Bulk Buyer' }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Buyer' })).toBeVisible();
  await expect(page.getByTestId('owed')).toHaveText('Rs 118.00');
  await page.getByRole('tab', { name: 'Documents' }).click();
  await expect(page.getByRole('table', { name: 'Documents' })).toContainText('INV/');
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByText('Customer since')).toBeVisible();
});

test('a freelancer runs a project with a timer, and bills it', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Startup Client', stateCode: '27' } });
  await page.goto('/app/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No projects here.' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Startup Client' });
  await page.getByLabel('Project name').fill('Website redesign');
  await page.getByLabel('Hourly rate (Rs)').fill('2000');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\//);
  await expect(page.getByRole('heading', { name: 'Website redesign' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Advance held' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deadlines' })).toBeVisible();

  await page.getByRole('button', { name: 'Start timer' }).click();
  await expect(page.getByTestId('timer')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('timer')).toBeVisible();                              // survives a reload
  await page.getByRole('button', { name: 'Stop and fill in the time' }).click();
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('1m');
  await page.getByLabel('Time', { exact: true }).fill('2h');
  await page.getByLabel('What was done').fill('Homepage design');
  await page.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 4,000.00');

  await page.getByLabel('Fee for').fill('Logo pack');
  await page.getByLabel('Fee (Rs, before GST)').fill('5000');
  await page.getByRole('button', { name: 'Add fee' }).click();
  await expect(page.getByTestId('unbilled')).toHaveText('Rs 9,000.00');
  await page.getByRole('button', { name: 'Create draft invoice' }).click();
  await expect(page.locator('.doc-amount .big')).toHaveText('Rs 10,620.00');
  const id = page.url().split('/').pop()!;
  const doc = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(doc.lines[0].hsn_sac).toBe('998314');

  // projects do not show up among legal matters, and the other way round
  await page.goto('/app/matters');
  await expect(page.getByRole('heading', { name: 'No matters here.' })).toBeVisible();
  await page.goto('/app/projects');
  await expect(page.getByRole('link', { name: 'Website redesign' })).toBeVisible();
});
