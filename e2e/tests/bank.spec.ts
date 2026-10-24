import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { makeBusiness, signedIn } from '../helpers';

test('a bank statement is matched to open invoices, recorded on confirmation, and never recorded twice', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Mehta Textiles', stateCode: '27' } });
  const party = (await (await page.request.get('/api/parties')).json()).parties[0];
  const mk = async (rate: string) => {
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId: party.id, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
    return d.id as string;
  };
  const first = await mk('11800');
  await mk('4000');

  const csv = [
    'Account Statement', 'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '05/10/2026,"NEFT MEHTA TEXTILES INV/26-27/0001",N1,,"11,800.00","11,800.00"',
    '06/10/2026,CASH DEPOSIT,,,"99.00","11,899.00"',
    'Closing balance,,,,,',
  ].join('\n');

  await page.goto('/app/bank');
  await expect(page.getByRole('heading', { name: 'Bank statement', exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await page.getByLabel('Statement file (CSV)').setInputFiles({ name: 'oct.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('bank-summary')).toContainText('2 lines read');
  await expect(page.getByTestId('bank-summary')).toContainText('1 have a suggested match');
  const select = page.getByLabel('Match for line 1');
  await expect(select).toContainText('INV/26-27/0001');
  await expect(page.getByTestId('bank-chosen')).toHaveText('1 chosen, Rs 11,800.00');         // the invoice number and the name back the amount, so it is chosen for you
  await expect(page.getByText('No match')).toBeVisible();

  await page.getByRole('button', { name: 'Record 1 payment' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 recorded' })).toBeVisible();
  await expect(page.getByText('Already recorded')).toBeVisible();

  const doc = await (await page.request.get(`/api/documents/${first}`)).json();
  expect(doc.document).toMatchObject({ payment_status: 'paid', amount_settled_paise: '1180000' });

  // the same file again changes nothing
  await page.getByLabel('Statement file (CSV)').setInputFiles({ name: 'oct.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Already recorded')).toBeVisible();
  await expect(page.getByTestId('bank-chosen')).toHaveText('0 chosen, Rs 0.00');
});

test('a file that is not a statement is explained, not guessed at', async ({ page, context }) => {
  const u = await signedIn(context);
  await makeBusiness(u.userId);
  await page.goto('/app/bank');
  await page.getByLabel('Statement file (CSV)').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('hello,world\n1,2') });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not find the header row' })).toBeVisible();
});
