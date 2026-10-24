import { expect, test, type BrowserContext } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  return { ...u, ...(await makeBusiness(u.userId)) };
}
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

test('the customer answers a quote from the shared link with a comment, and the owner sees it', async ({ page, context, browser }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Link Buyer', stateCode: '27' } })).json();
  const est = await (await page.request.post('/api/documents', { data: { docType: 'estimate', partyId: party.id, dueDate: addDays(istToday(), 10),
    lines: [{ name: 'Brand kit', hsnSac: '998314', quantity: '1', rate: '8000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${est.id}/issue`, { data: {} });
  const { url } = await (await page.request.post(`/api/documents/${est.id}/share`, { data: {} })).json();

  // a visitor with no sign-in
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(url);
  await expect(v.getByRole('heading', { name: 'Your answer', exact: true })).toBeVisible();
  await v.getByLabel('Your name').fill('Anita');
  await v.getByRole('button', { name: 'Decline' }).click();
  await expect(v.getByRole('alert')).toContainText('briefly why');
  await v.getByLabel('Your name').fill('Anita');
  await v.getByLabel(/Comment/).fill('Please bring the price down');
  await v.getByRole('button', { name: 'Decline' }).click();
  await expect(v.getByRole('heading', { name: 'You declined this quote', exact: true })).toBeVisible();
  await visitor.close();

  await page.goto(`/app/invoices/${est.id}`);
  await expect(page.getByTestId('estimate-status')).toHaveText('Declined');
  await expect(page.getByTestId('quote-answer')).toContainText('Anita');
  await expect(page.getByTestId('quote-answer')).toContainText('Please bring the price down');
});

test('a quote is revised, the old version is withdrawn, and the accepted version becomes an order and an invoice', async ({ page, context }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Chain Buyer', stateCode: '27' } })).json();
  const est = await (await page.request.post('/api/documents', { data: { docType: 'estimate', partyId: party.id, dueDate: addDays(istToday(), 10),
    lines: [{ name: 'Audit', hsnSac: '998311', quantity: '1', rate: '4000', taxRateBp: 1800, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${est.id}/issue`, { data: {} });

  await page.goto(`/app/invoices/${est.id}`);
  await page.getByRole('button', { name: 'Revise (new version)' }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft', exact: true })).toBeVisible();
  await page.getByLabel('Line 1 rate').fill('3500');
  await page.getByRole('button', { name: 'Issue estimate' }).click();
  await expect(page.getByTestId('quote-versions')).toContainText('v2');

  await page.goto(`/app/invoices/${est.id}`);
  await expect(page.getByTestId('estimate-status')).toHaveText('Cancelled');
  await page.getByRole('link', { name: /v2 EST/ }).click();
  await page.getByRole('button', { name: 'Make a sales order' }).click();
  await expect(page.getByRole('heading', { name: /Sales order/ })).toBeVisible();
  await page.getByRole('button', { name: 'Issue' }).click();
  await expect(page.getByRole('heading', { name: /Sales order SO\// })).toBeVisible();
  await page.getByRole('button', { name: 'Make a tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  await expect(page.getByText(/Made from Sales order SO\//)).toBeVisible();
});

test('a recurring schedule shows its next dates, skips one, and says so in the history', async ({ page, context }) => {
  await owner(context);
  const party = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Plan Buyer', stateCode: '27' } })).json();
  const start = addDays(istToday(), 7);
  await page.request.post('/api/recurring', { data: { name: 'Plan retainer', partyId: party.id, unit: 'week', everyN: 1, startDate: start, mode: 'draft', termsDays: 7,
    lines: [{ name: 'Retainer', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800 }] } });

  await page.goto('/app/recurring');
  await page.getByRole('button', { name: 'Schedule' }).click();
  const panel = page.getByTestId('schedule-panel');
  await expect(panel.getByRole('table', { name: 'Next invoices' }).getByRole('row')).toHaveCount(7);   // header and six dates
  await expect(panel).toContainText(start);
  await expect(panel).toContainText('Rs 1,180.00');
  await panel.getByRole('button', { name: /Skip the next invoice/ }).click();
  await expect(page.getByText(`Skipped ${start}.`)).toBeVisible();
  await expect(page.getByRole('row', { name: /Plan retainer/ })).toContainText(addDays(start, 7));
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Skipped. Skipped by you.')).toBeVisible();
});

test('the new recurring form shows the dates it would run on and what auto-send does', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/recurring');
  await page.getByRole('button', { name: 'New recurring invoice' }).click();
  await page.getByLabel('First invoice on').fill('2026-01-31');
  await expect(page.getByTestId('form-dates')).toContainText('2026-01-31, 2026-02-28, 2026-03-31');
  await page.getByLabel('On each date').selectOption('issue_and_send');
  await expect(page.getByTestId('mode-help')).toContainText('sends it to the customer');
});

test('a custom field is filled on an invoice, printed on it, and kept for a customer', async ({ page, context }) => {
  await owner(context);
  const field = await (await page.request.post('/api/custom-fields', { data: { entity: 'document', label: 'Project code', kind: 'text', showOnPdf: true } })).json();
  const cust = await (await page.request.post('/api/custom-fields', { data: { entity: 'customer', label: 'Vendor code', kind: 'text', showOnPdf: true } })).json();
  expect(field.id && cust.id).toBeTruthy();
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Field Buyer', stateCode: '27' } });

  await page.goto('/app/customers');
  await page.getByRole('row', { name: /Field Buyer/ }).getByRole('button', { name: 'Fields' }).click();
  await page.getByLabel('Vendor code').fill('V-204');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/app/invoices/new');
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Field Buyer' });
  await page.getByLabel('Line 1 description').fill('Consulting');
  await page.getByLabel('Line 1 HSN or SAC').fill('998313');
  await page.getByLabel('Line 1 rate').fill('1000');
  await page.getByLabel('Project code').fill('P-77');
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}/);
  const id = page.url().match(/invoices\/([0-9a-f-]{36})/)![1];
  const html = (await (await page.request.get(`/api/documents/${id}/html`)).json()).html as string;
  expect(html).toContain('Project code');
  expect(html).toContain('P-77');
  expect(html).toContain('Vendor code:</span> V-204');
});

test('the editor works from the keyboard and saves the draft by itself', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices/new');
  await expect(page.getByTestId('save-status')).toContainText('saves by itself');
  await page.getByLabel('Line 1 description').fill('Chair');
  await page.getByLabel('Line 1 HSN or SAC').fill('9401');
  await page.getByLabel('Line 1 rate').fill('100');
  await page.getByLabel('Line 1 rate').press('Enter');                       // Enter on the last line adds one and moves to it
  await expect(page.getByLabel('Line 2 description')).toBeFocused();
  await page.getByLabel('Line 2 description').fill('Table');
  await page.getByLabel('Line 2 description').press('Control+d');            // copy the line
  await expect(page.getByLabel('Line 3 description')).toHaveValue('Table');
  await page.getByLabel('Line 3 description').press('Alt+ArrowUp');          // move it up
  await expect(page.getByLabel('Line 2 description')).toHaveValue('Table');
  await page.getByLabel('Line 2 description').press('Control+z');            // undo the move
  await page.getByLabel('Line 3 description').press('Control+z');
  await expect(page.getByLabel('Line 3 description')).toHaveCount(0);        // the copy is undone
  await page.getByRole('button', { name: 'Move line 1 down' }).click();
  await expect(page.getByLabel('Line 1 description')).toHaveValue('Table');

  // the draft saves a couple of seconds after the last change, and says so
  await expect(page.getByTestId('save-status')).toContainText('Draft saved at', { timeout: 20_000 });
  await page.goto('/app/invoices');
  await expect(page.getByRole('row', { name: /Draft/ }).first()).toBeVisible();
});
