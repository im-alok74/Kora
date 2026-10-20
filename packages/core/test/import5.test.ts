import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, commitImport, commitInvoiceImport, createBusiness, createParty, getDocument, importTextFrom, listDocuments, listParties, makeXlsx, parseTallyLedgers, previewImport,
  previewInvoiceImport, resolveTenant, type TenantSession,
} from '../src/index.js';

describe('Tally ledgers', () => {
  const xml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
    <TALLYMESSAGE><LEDGER NAME="Mehta &amp; Sons" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27aabcm1234f1z5</PARTYGSTIN><LEDSTATENAME>Maharashtra</LEDSTATENAME>
      <ADDRESS.LIST TYPE="String"><ADDRESS>221 Textile Market</ADDRESS><ADDRESS>Mumbai</ADDRESS></ADDRESS.LIST><PINCODE>400002</PINCODE><LEDGERMOBILE>9988776655</LEDGERMOBILE><EMAIL>a@mehta.test</EMAIL></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="Steel Supplier"><PARENT>Sundry Creditors</PARENT></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="Cash Customer"><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE>
  </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  it('makes customers from the debtors only, with the details Tally holds', () => {
    const csv = parseTallyLedgers(xml);
    expect(csv.split('\r\n')[0]).toBe('Name,GSTIN,State,Phone,Email,Address,Pincode');
    expect(csv).toContain('Mehta & Sons,27AABCM1234F1Z5,Maharashtra,9988776655,a@mehta.test,"221 Textile Market, Mumbai",400002');
    expect(csv).toContain('Cash Customer');
    expect(csv).not.toContain('Steel Supplier');
  });
  it('says what is wrong with a file that has no ledgers or no debtors', () => {
    expect(() => parseTallyLedgers('<ENVELOPE></ENVELOPE>')).toThrow(/No ledgers were found/);
    expect(() => parseTallyLedgers('<LEDGER NAME="X"><PARENT>Sundry Creditors</PARENT></LEDGER>')).toThrow(/none are under Sundry Debtors/);
    expect(() => parseTallyLedgers('<LEDGER NAME="x"/>' + 'a'.repeat(5_000_001))).toThrow(/larger than 5 MB/);
  });
});

describe('importing into a business', () => {
  let db: TestDb;
  let owner: TenantSession, accountant: TenantSession;
  beforeAll(async () => {
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [o, a] = [await mk('o@i.test'), await mk('a@i.test')];
    const bid = await createBusiness(db.web, o, { legalName: 'Import Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, o, bid, a, 'accountant');
    owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('reads the column names Zoho Invoice and other software use, and state abbreviations', async () => {
    const csv = [
      'Display Name,Company Name,EmailID,MobilePhone,GST Identification Number (GSTIN),Place of Contact,Billing Address,Billing City,Billing Code',
      'Asha Stores,Asha Stores Pvt Ltd,asha@x.test,9876501234,,MH,12 Lane,Pune,411001',
      'Kumar Traders,,k@x.test,9876501235,,KA,5 Road,Bengaluru,560001',
    ].join('\n');
    const p = await previewImport(db.web, owner, 'customers', csv);
    expect(p.counts).toMatchObject({ total: 2, ok: 2, error: 0 });
    expect(p.columns.mapped).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'state', 'address', 'city', 'pincode']));
    const r = await commitImport(db.web, owner, 'customers', csv);
    expect(r.created).toBe(2);
    const list = (await listParties(db.web, owner, {})) as unknown as { name: string; state_code: string }[];
    expect(list.find((x) => x.name === 'Asha Stores')!.state_code).toBe('27');
    expect(list.find((x) => x.name === 'Kumar Traders')!.state_code).toBe('29');
  });
  it('imports an Excel file through the same checks as a CSV', async () => {
    const buf = makeXlsx([{ name: 'Items', columns: [{ key: 'name', label: 'Item Name' }, { key: 'hsn', label: 'HSN/SAC' }, { key: 'gst', label: 'Intra State Tax Percentage' }, { key: 'kind', label: 'Product Type' }, { key: 'price', label: 'Rate' }],
      rows: [{ name: 'Excel Widget', hsn: '8479', gst: '18', kind: 'goods', price: '99.50' }, { name: 'Excel Service', hsn: '998313', gst: '12', kind: 'service', price: '500' }, { name: 'Bad GST', hsn: '8479', gst: '17', kind: 'goods', price: '1' }] }]);
    const text = importTextFrom({ xlsxBase64: buf.toString('base64') });
    const p = await previewImport(db.web, owner, 'items', text);
    expect(p.counts).toMatchObject({ total: 3, ok: 2, error: 1 });
    expect(p.rows.find((r) => r.status === 'error')!.message).toMatch(/17% is not a GST rate/);
    const r = await commitImport(db.web, owner, 'items', text);
    expect(r).toMatchObject({ created: 2, failed: 1 });
    expect((await commitImport(db.web, owner, 'items', text)).created).toBe(0);               // importing again adds nothing
    expect(() => importTextFrom({ xlsxBase64: 'not base64!' })).toThrow(/could not be read/);
    expect(importTextFrom({ csv: 'a,b' })).toBe('a,b');
  });
  it('imports customers from Tally', async () => {
    const text = importTextFrom({ tallyXml: '<LEDGER NAME="Tally Debtor"><PARENT>Sundry Debtors</PARENT><LEDSTATENAME>Gujarat</LEDSTATENAME></LEDGER>' });
    expect((await commitImport(db.web, owner, 'customers', text)).created).toBe(1);
  });

  describe('invoices from a spreadsheet', () => {
    const csv = [
      'Invoice Number,Invoice Date,Due Date,Customer Name,Item Name,HSN/SAC,Quantity,Rate,GST %,Discount,Notes',
      'Z-101,05/10/2026,04/11/2026,Asha Stores,Design work,998313,1,10000,18,,First batch',
      'Z-101,,,,Hosting,998315,2,"1,500",18,100,',
      'Z-102,2026-10-06,,Kumar Traders,Boxes,4819,10,50,12,,',
      'Z-103,07/10/2026,,Nobody Known,Item,998313,1,100,18,,',
      'Z-104,31/02/2026,,Asha Stores,Item,998313,1,100,18,,',
      'Z-105,08/10/2026,,Asha Stores,Item,998313,1,100,17,,',
    ].join('\n');
    it('checks every invoice and groups the rows that share a reference, without saving anything', async () => {
      const before = (await listDocuments(db.web, owner, {})).length;
      const p = await previewInvoiceImport(db.web, owner, csv);
      expect(p.counts).toMatchObject({ total: 5, ok: 2, error: 3, existing: 0 });
      const z101 = p.docs.find((d) => d.ref === 'Z-101')!;
      expect(z101).toMatchObject({ status: 'ok', customer: 'Asha Stores', lines: 2, date: '2026-10-05' });
      expect(z101.totalPaise).toBe('1522200');                                         // 10000 + (3000 less 100) = 12900 taxable, plus 18% = 15222
      expect(p.docs.find((d) => d.ref === 'Z-102')!.status).toBe('ok');
      expect(p.docs.find((d) => d.ref === 'Z-103')!.message).toMatch(/"Nobody Known" is not in your customers/);
      expect(p.docs.find((d) => d.ref === 'Z-104')!.message).toMatch(/is not a date/);
      expect(p.docs.find((d) => d.ref === 'Z-105')!.message).toMatch(/tax rate of 17%/);
      expect((await listDocuments(db.web, owner, {})).length).toBe(before);              // a dry run writes nothing
    });
    it('makes drafts for the good invoices, keeps the old number as the reference, and does not repeat on a second import', async () => {
      const r = await commitInvoiceImport(db.web, owner, csv);
      expect(r).toMatchObject({ created: 2, existing: 0, failed: 3 });
      const doc = (await getDocument(db.web, owner, r.ids[0]!))!;
      expect(doc.document).toMatchObject({ status: 'draft', number: null, reference: 'Z-101', notes: 'First batch', doc_type: 'tax_invoice' });
      expect(doc.lines).toHaveLength(2);
      expect(doc.lines[1]).toMatchObject({ item_name: 'Hosting', quantity: '2.000', discount_paise: '10000' });
      const again = await commitInvoiceImport(db.web, owner, csv);
      expect(again).toMatchObject({ created: 0, existing: 2, failed: 3 });
      expect((await previewInvoiceImport(db.web, owner, csv)).counts).toMatchObject({ existing: 2, ok: 0, error: 3 });
    });
    it('needs the right columns, a real file, and the right to write', async () => {
      await expect(previewInvoiceImport(db.web, owner, 'Foo,Bar\n1,2')).rejects.toThrow(/needs a column for the customer, the item or description, the rate/);
      await expect(previewInvoiceImport(db.web, owner, '')).rejects.toThrow(/empty/);
      await expect(previewInvoiceImport(db.web, owner, 'Customer,Item,Rate')).rejects.toThrow(/no invoice rows/);
      await expect(commitInvoiceImport(db.web, accountant, csv.replace(/Z-/g, 'Q-'))).rejects.toThrow();
      await expect(previewInvoiceImport(db.web, owner, csv, 'credit_note' as never)).rejects.toThrow(/Choose what the drafts/);
    });
    it('treats rows with no reference column as one invoice each', async () => {
      const p = await previewInvoiceImport(db.web, owner, 'Customer,Item,Rate\nAsha Stores,A,10\nAsha Stores,B,20');
      expect(p.counts.total).toBe(2);
    });
  });
});
