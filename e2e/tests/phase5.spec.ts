import { expect, test } from '@playwright/test';
import { makeXlsx } from '../../packages/core/src/files';
import { makeBusiness, signedIn } from '../helpers';

test('customers come in from an Excel file with another program\'s column names', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  const xlsx = makeXlsx([{ name: 'Contacts', columns: [{ key: 'n', label: 'Display Name' }, { key: 'e', label: 'EmailID' }, { key: 's', label: 'Place of Contact' }, { key: 'c', label: 'Billing City' }],
    rows: [{ n: 'Excel Customer One', e: 'one@x.test', s: 'MH', c: 'Pune' }, { n: 'Excel Customer Two', e: 'two@x.test', s: 'Karnataka', c: 'Bengaluru' }] }]);
  await page.goto('/app/data');
  await page.getByLabel('CSV file').setInputFiles({ name: 'contacts.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await expect(page.getByTestId('count-ok')).toHaveText('2');
  await page.getByRole('button', { name: 'Import 2 customers' }).click();
  await expect(page.getByTestId('import-result')).toContainText('2 added');
  const parties = (await (await page.request.get('/api/parties')).json()).parties as { name: string; state_code: string }[];
  expect(parties.find((p) => p.name === 'Excel Customer One')!.state_code).toBe('27');
  expect(parties.find((p) => p.name === 'Excel Customer Two')!.state_code).toBe('29');
});

test('customers come in from a Tally ledger export, debtors only', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  const xml = '<ENVELOPE><LEDGER NAME="Tally Debtor"><PARENT>Sundry Debtors</PARENT><LEDSTATENAME>Gujarat</LEDSTATENAME></LEDGER><LEDGER NAME="Tally Supplier"><PARENT>Sundry Creditors</PARENT></LEDGER></ENVELOPE>';
  await page.goto('/app/data');
  await page.getByLabel('CSV file').setInputFiles({ name: 'ledgers.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.getByTestId('count-ok')).toHaveText('1');
  await page.getByRole('button', { name: 'Import 1 customer' }).click();
  await expect(page.getByTestId('import-result')).toContainText('1 added');
  const names = ((await (await page.request.get('/api/parties')).json()).parties as { name: string }[]).map((p) => p.name);
  expect(names).toContain('Tally Debtor');
  expect(names).not.toContain('Tally Supplier');
});

test('invoices come in from a spreadsheet as drafts, are checked first, and are not made twice', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Asha Stores', stateCode: '27' } });
  const csv = [
    'Invoice Number,Invoice Date,Customer Name,Item Name,HSN/SAC,Quantity,Rate,GST %',
    'OLD-1,05/10/2026,Asha Stores,Design work,998313,1,10000,18',
    'OLD-1,,,Hosting,998315,2,1500,18',
    'OLD-2,06/10/2026,Nobody Known,Item,998313,1,100,18',
  ].join('\n');
  await page.goto('/app/data');
  await page.getByLabel('Invoice file (CSV or Excel)').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('inv-ok')).toHaveText('1');
  await expect(page.getByTestId('inv-err')).toHaveText('1');
  const table = page.getByRole('table', { name: 'Invoices found' });
  await expect(table).toContainText('OLD-1');
  await expect(table).toContainText('Rs 15,340.00');                                               // 10000 + 3000 = 13000, plus 18%
  await expect(table).toContainText('"Nobody Known" is not in your customers');

  await page.getByRole('button', { name: 'Make 1 draft' }).click();
  await expect(page.getByTestId('invoice-import-result')).toContainText('1 draft made');
  const docs = (await (await page.request.get('/api/documents?status=draft')).json()).documents as { id: string; number: string | null }[];
  expect(docs).toHaveLength(1);
  const doc = await (await page.request.get(`/api/documents/${docs[0]!.id}`)).json();
  expect(doc.document).toMatchObject({ status: 'draft', number: null, reference: 'OLD-1' });
  expect(doc.lines).toHaveLength(2);

  await page.getByLabel('Invoice file (CSV or Excel)').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('inv-existing')).toHaveText('1');
  await expect(page.getByTestId('inv-ok')).toHaveText('0');
});

test('a customer\'s statement can be downloaded from their page', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Statement Buyer', stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '700', taxRateBp: 0, kind: 'service' }] } })).json();
  await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  await page.goto(`/app/customers/${party.id}`);
  await page.getByRole('tab', { name: 'Payments' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download statement (CSV)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^statement_/);
  const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
  expect(text).toContain('700.00');
});
