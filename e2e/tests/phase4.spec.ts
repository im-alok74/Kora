import { expect, test } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

test('a business writes its own message, sees how it will read, and can go back to the default', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/settings');
  const box = page.getByLabel('When you send a document');
  await expect(box).toHaveValue(/View and download: \{link\}/);

  await box.fill('Dear {customer}, you owe {amount}.');
  await page.getByRole('button', { name: 'Save invoice message' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Include {link}' })).toBeVisible();

  await box.fill('Hello {customer}, {type} {number} is here: {link}');
  await expect(page.getByText('Hello Asha Stores, Tax invoice INV/26-27/0042 is here: https://kora.example/i/abc123')).toBeVisible();
  await page.getByRole('button', { name: 'Save invoice message' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The invoice message is saved.' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('When you send a document')).toHaveValue('Hello {customer}, {type} {number} is here: {link}');
  await page.getByRole('button', { name: 'Use Kora’s wording' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'back to Kora' })).toBeVisible();
  await expect(page.getByLabel('When you send a document')).toHaveValue(/View and download: \{link\}/);

  // a name that does not exist is refused in plain words
  await page.getByLabel('When a reminder goes out').fill('Pay {nothing} {link}');
  await page.getByRole('button', { name: 'Save reminder message' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '{nothing} is not something Kora can fill in' })).toBeVisible();
});

test('a look is chosen from samples, saved, and used on the invoice', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/settings');
  const gallery = page.getByRole('group', { name: 'Choose a look' });
  await expect(gallery.getByRole('button', { name: /Modern/ })).toBeVisible();
  await expect(gallery.getByRole('button', { name: /Classic/ })).toHaveAttribute('aria-pressed', 'true');
  await gallery.getByRole('button', { name: /Modern/ }).click();
  await expect(gallery.getByRole('button', { name: /Modern/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Layout')).toHaveValue('modern');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Template saved.' })).toBeVisible();

  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Look Buyer', desc: 'Item', rate: '100' });
  await page.getByRole('button', { name: 'Issue tax invoice' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const paper = page.frameLocator('iframe[title="Document preview"]');
  await expect(paper.locator('.page.lay-modern')).toBeVisible();
  await expect(paper.getByText('GSTIN:').first()).toBeVisible();
});

test('every payment has a receipt that can be opened, for the invoice and from the customer page', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Receipt Buyer', stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '2000', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.request.post(`/api/documents/${d.id}/payments`, { data: { amount: '500', method: 'upi' } });

  await page.goto(`/app/invoices/${d.id}`);
  const link = page.getByRole('link', { name: 'Receipt' });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  const pdf = await page.request.get(href);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  const html = (await (await page.request.get(`${href}?format=html`)).json()).html as string;
  expect(html).toContain('Payment Receipt');
  expect(html).toContain('Receipt Buyer');
  expect(html).toContain('500.00');
  expect(html).toContain('1,500.00');                                     // what is left on the invoice

  await page.goto(`/app/customers/${party.id}`);
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByRole('link', { name: 'Receipt' })).toBeVisible();
  expect((await page.request.get('/api/payments/00000000-0000-0000-0000-000000000000/receipt')).status()).toBe(404);
});
