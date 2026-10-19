import { expect, test, type BrowserContext } from '@playwright/test';
import { fillInvoice, makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}

test('TCS and TDS are entered as percentages, shown in the totals, and come back when the draft is reopened', async ({ page, context }) => {
  await owner(context);
  await page.goto('/app/invoices/new');
  await fillInvoice(page, { customer: 'Corporate Buyer', rate: '10000' });
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 11,800.00');

  await page.getByLabel('TCS rate (%)').fill('1');
  await page.getByLabel('TDS rate (%)').fill('10');
  await expect(page.getByTestId('tcs-amount')).toHaveText('Rs 118.00');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 11,918.00');           // TCS is added to the total
  await expect(page.getByTestId('tds-note')).toContainText('Rs 1,000.00');            // TDS is not
  await expect(page.getByTestId('tds-note')).toContainText('Rs 10,918.00');

  // a value that is not a percentage is refused before anything is saved
  await page.getByLabel('TDS rate (%)').fill('1.234');
  await expect(page.locator('p[role="alert"]')).toContainText('percentage between 0 and 100');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: 'New tax invoice' })).toBeVisible();   // still on the editor
  await page.getByLabel('TDS rate (%)').fill('10');

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice/ })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('TCS rate (%)')).toHaveValue('1');
  await expect(page.getByLabel('TDS rate (%)')).toHaveValue('10');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 11,918.00');

  // issued, the PDF page carries the TDS lines
  await page.getByRole('button', { name: /Issue tax invoice/ }).click();
  await expect(page.getByRole('heading', { name: /Tax invoice INV/ })).toBeVisible();
  const id = page.url().split('/').pop()!.split('?')[0]!;
  const res = await page.request.get(`/api/documents/${id}/html`);
  expect(res.status(), await res.text()).toBe(200);
  const html = await res.json();
  expect(html.html).toContain('Less: TDS to be deducted');
  expect(html.html).toContain('Net payable by customer');
});

test('GSTR-3B data lays out tables 3.1 and 3.2 and downloads as JSON', async ({ page, context }) => {
  await owner(context);
  const walkin = await (await page.request.post('/api/parties', { data: { kind: 'customer', name: 'Far Consumer', stateCode: '29' } })).json();
  const mk = async (partyId: string, rate: string) => {
    const d = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', partyId, lines: [{ name: 'Item', hsnSac: '847130', quantity: '1', rate, taxRateBp: 1800 }] } })).json();
    await page.request.post(`/api/documents/${d.id}/issue`, { data: {} });
  };
  await mk(walkin.id, '1000');                                        // inter-state to a buyer without a GSTIN
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

  await page.goto('/app/reports');
  await page.getByRole('tab', { name: 'GSTR-3B data' }).click();
  await expect(page.getByRole('columnheader', { name: '3.1 Outward supplies' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Tax payable before input credit/ })).toContainText('Rs 180.00');   // IGST on Rs 1,000
  await expect(page.getByRole('heading', { name: /3\.2 Inter-state supplies/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Karnataka' })).toBeVisible();
  await expect(page.getByText(/input tax credit/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download GSTR-3B JSON' })).toBeVisible();

  const dl = await page.request.get(`/api/reports/gstr3b?period=${month}&download=1`);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toContain(`GSTR3B_${month}.json`);
  const j = await dl.json();
  expect(j.ret_period).toBe(`${month.slice(5)}${month.slice(0, 4)}`);
  expect(j.sup_details.osup_det).toMatchObject({ txval: 1000, iamt: 180, camt: 0, samt: 0 });
  expect(j.inter_sup.unreg_details).toEqual([{ pos: '29', txval: 1000, iamt: 180 }]);
});
