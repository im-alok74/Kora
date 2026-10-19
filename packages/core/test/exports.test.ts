import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, archiveParty, createBusiness, createItem, createParty, exportBackup, exportWorkbook, issueDocument, readStoredZip, recordPayment, resolveTenant,
  saveDraft, saveExpense, ForbiddenError, ValidationError, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession, other: TenantSession;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const sheetsOf = (xlsx: Buffer) => {
  const parts = Object.fromEntries(readStoredZip(xlsx).map((e) => [e.name, e.data.toString('utf8')]));
  const names = [...parts['xl/workbook.xml']!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
  return { parts, names };
};

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (email: string) => (await db.owner`insert into app_user (email) values (${email}) returning id`)[0]!.id as string;
  const [u, s, a, o] = [await mk('o@e.test'), await mk('s@e.test'), await mk('a@e.test'), await mk('x@e.test')];
  const g29 = '29AAPFU0939F1Z';
  const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u, bid, s, 'staff'); await addMember(db.web, u, bid, a, 'accountant');
  owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, o, await createBusiness(db.web, o, { legalName: 'Other Co', gstin: g29 + gstinCheckChar(g29), stateCode: '29', registrationType: 'regular' }));

  const evil = await createParty(db.web, owner, { kind: 'customer', name: '=HYPERLINK("http://evil.example")', stateCode: '27', phone: '9876543210' });
  const hindi = await createParty(db.web, owner, { kind: 'customer', name: 'नमस्ते स्टोर्स', stateCode: '27' });
  const gone = await createParty(db.web, owner, { kind: 'customer', name: 'Archived Customer', stateCode: '27' });
  await archiveParty(db.web, owner, gone);
  await createItem(db.web, owner, { name: 'Widget', defaultRateBp: 1800, hsnSac: '8471', price: '250.50' });
  await createParty(db.web, other, { kind: 'customer', name: 'Secret Other Customer', stateCode: '29' });

  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: evil, docDate: today(), dueDate: today(),
    lines: [{ name: 'Widget', hsnSac: '8471', quantity: '2', rate: '500', taxRateBp: 1800 }, { name: 'Service', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }] });
  await issueDocument(db.web, owner, id);
  await recordPayment(db.web, owner, { documentId: id, amount: '500', method: 'upi' });
  await saveDraft(db.web, owner, { docType: 'estimate', partyId: hindi, docDate: '2020-01-15', lines: [{ name: 'Old quote', hsnSac: '8471', quantity: '1', rate: '10', taxRateBp: 1800 }] });
  await saveExpense(db.web, owner, { category: 'Rent', amount: '1000', vendor: 'Landlord' });
  await saveExpense(db.web, owner, { category: 'Rent', amount: '5', date: '2020-02-02' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('Excel export', () => {
  it('has a sheet per data set with the business\'s real figures, and nothing from another business or an archived customer', async () => {
    const x = await exportWorkbook(db.web, owner);
    const { parts, names } = sheetsOf(x.buffer);
    expect(names).toEqual(['Customers', 'Items', 'Documents', 'Document lines', 'Payments', 'Expenses']);
    expect(x.counts).toEqual({ customers: 2, items: 1, documents: 2, document_lines: 3, payments: 1, expenses: 2 });
    const all = Object.values(parts).join('\n');
    expect(all).not.toContain('Secret Other Customer');
    expect(all).not.toContain('Archived Customer');
    expect(parts['xl/worksheets/sheet1.xml']).toContain('नमस्ते स्टोर्स');
    expect(parts['xl/worksheets/sheet1.xml']).toContain('=HYPERLINK(&quot;http://evil.example&quot;)');       // text, not a formula
    expect(all).not.toContain('<f>');
    expect(parts['xl/worksheets/sheet2.xml']).toContain('<v>250.50</v>');                                       // price as a number
    expect(parts['xl/worksheets/sheet3.xml']).toContain('<v>1298.00</v>');                                      // 1,100 plus 198 GST
  });

  it('can be limited to some data sets and a date range', async () => {
    const x = await exportWorkbook(db.web, owner, { datasets: ['expenses', 'documents'], from: '2020-01-01', to: '2020-12-31' });
    expect(x.counts).toEqual({ expenses: 1, documents: 1 });
    expect(x.filename).toBe('kora_data_2020-01-01_to_2020-12-31.xlsx');
    expect(sheetsOf(x.buffer).names).toEqual(['Expenses', 'Documents']);
  });

  it('refuses unknown data sets and bad dates, and is for owners and accountants', async () => {
    expect(await fails(exportWorkbook(db.web, owner, { datasets: ['passwords'] }))).toBeInstanceOf(ValidationError);
    expect(await fails(exportWorkbook(db.web, owner, { from: '2026-13-01' }))).toBeInstanceOf(ValidationError);
    expect(await fails(exportWorkbook(db.web, owner, { from: '2026-02-01', to: '2026-01-01' }))).toBeInstanceOf(ValidationError);
    expect(await fails(exportWorkbook(db.web, staff))).toBeInstanceOf(ForbiddenError);
    expect((await exportWorkbook(db.web, accountant, { datasets: ['items'] })).counts).toEqual({ items: 1 });
  });
});

describe('backup', () => {
  it('is a ZIP with a CSV per data set, one JSON file, and a plain README', async () => {
    const b = await exportBackup(db.web, owner);
    const files = Object.fromEntries(readStoredZip(b.buffer).map((e) => [e.name, e.data.toString('utf8')]));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'customers.csv', 'data.json', 'document_lines.csv', 'documents.csv', 'expenses.csv', 'items.csv', 'payments.csv']);
    expect(b.filename).toMatch(/^kora_backup_\d{4}-\d{2}-\d{2}\.zip$/);
    expect(files['README.txt']).toContain('Acme Traders');
    expect(files['README.txt']).toContain('legal records');
    expect(files['customers.csv']).toContain(`"'=HYPERLINK(""http://evil.example"")"`);                       // a spreadsheet cannot run it
    expect(files['customers.csv']).toContain('नमस्ते स्टोर्स');
    const j = JSON.parse(files['data.json']!);
    expect(j).toMatchObject({ format: 'kora-backup', version: 1, business: { legal_name: 'Acme Traders', gstin: '27AAPFU0939F1ZV' } });
    expect(j.datasets.documents.rows).toHaveLength(2);
    const inv = j.datasets.documents.rows.find((r: any) => r.number);
    expect(inv).toMatchObject({ doc_type: 'Tax invoice', status: 'issued', total: '129800', settled: '50000', payment_status: 'part_paid' });   // paise, as strings
    expect(j.datasets.payments.rows[0]).toMatchObject({ amount: '50000', method: 'upi', applied_to: inv.number });
    expect(JSON.stringify(j)).not.toContain('Secret Other Customer');
  });

  it('is for owners and accountants only, and leaves a record of each export', async () => {
    expect(await fails(exportBackup(db.web, staff))).toBeInstanceOf(ForbiddenError);
    await exportBackup(db.web, accountant);
    const log = await db.owner`select kind, user_id, detail from data_export where business_id = ${owner.businessId} order by created_at`;
    expect(log.map((l) => l.kind)).toContain('backup');
    expect(log.map((l) => l.kind)).toContain('workbook');
    expect(log.find((l) => l.kind === 'backup' && l.user_id === accountant.userId)!.detail).toMatchObject({ customers: 2, documents: 2 });
    expect((await db.owner`select count(*)::int as n from data_export where business_id = ${other.businessId}`)[0]!.n).toBe(0);
  });
});
