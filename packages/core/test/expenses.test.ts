import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, createBusiness, deleteExpense, getExpense, getReceipt, listExpenses, removeReceipt, resolveTenant, saveExpense, setReceipt, toCsv,
  EXPENSE_COLUMNS, ForbiddenError, ValidationError, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession, other: TenantSession;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');

beforeAll(async () => {
  db = await makeTestDb();
  const mkUser = async (email: string) => (await db.owner`insert into app_user (email) values (${email}) returning id`)[0]!.id as string;
  const [u, s, a, o] = [await mkUser('o@example.test'), await mkUser('s@example.test'), await mkUser('a@example.test'), await mkUser('x@example.test')];
  const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u, bid, s, 'staff');
  await addMember(db.web, u, bid, a, 'accountant');
  owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid); accountant = await resolveTenant(db.web, a, bid);
  const bid2 = await createBusiness(db.web, o, { legalName: 'Other Co', gstin: (() => { const g = '29AAPFU0939F1Z'; return g + gstinCheckChar(g); })(), stateCode: '29', registrationType: 'regular' });
  other = await resolveTenant(db.web, o, bid2);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('expenses', () => {
  it('records, totals by category, and filters', async () => {
    await saveExpense(db.web, owner, { category: 'Rent', amount: '25000', vendor: 'Landlord', paidVia: 'bank_transfer' });
    await saveExpense(db.web, owner, { category: 'Travel', amount: '1180.00', gst: '180', vendor: 'Cab Co', notes: 'Client visit' });
    await saveExpense(db.web, staff, { category: 'Travel', amount: '500', date: today() });
    await saveExpense(db.web, owner, { category: 'Rent', amount: '999', date: '2020-01-05' });            // another period

    const l = await listExpenses(db.web, owner);
    expect(l.rows).toHaveLength(3);
    expect([l.total, l.gst]).toEqual(['2668000', '18000']);
    expect(l.byCategory).toEqual([{ category: 'Rent', total: '2500000' }, { category: 'Travel', total: '168000' }]);
    expect((await listExpenses(db.web, owner, { category: 'Travel' })).rows).toHaveLength(2);
    expect((await listExpenses(db.web, owner, { q: 'cab' })).rows.map((r) => r.vendor)).toEqual(['Cab Co']);
    const old = await listExpenses(db.web, owner, { from: '2020-01-01', to: '2020-01-31' });
    expect(old.rows).toHaveLength(1);
    expect(old.total).toBe('99900');
    expect(await fails(listExpenses(db.web, owner, { from: '2026-02-01', to: '2026-01-01' }))).toBeInstanceOf(ValidationError);
  });

  it('refuses amounts and dates that make no sense', async () => {
    for (const bad of [{ amount: '0' }, { amount: '-5' }, { amount: 'abc' }, { amount: '100', gst: '101' }, { amount: '100', gst: '-1' },
                       { amount: '100', date: '2026-13-40' }, { amount: '100', paidVia: 'barter' }, { amount: '100', category: '  ' }]) {
      expect(await fails(saveExpense(db.web, owner, { category: 'Other', ...bad }))).toBeInstanceOf(ValidationError);
    }
  });

  it('edits and deletes, and says so when the expense does not exist', async () => {
    const { id } = await saveExpense(db.web, owner, { category: 'Utilities', amount: '700' });
    await saveExpense(db.web, owner, { category: 'Utilities', amount: '800', vendor: 'Power Co' }, id);
    expect(await getExpense(db.web, owner, id)).toMatchObject({ amount_paise: '80000', vendor: 'Power Co' });
    await deleteExpense(db.web, owner, id);
    expect(await getExpense(db.web, owner, id)).toBeNull();
    expect(await fails(deleteExpense(db.web, owner, id))).toBeInstanceOf(ValidationError);
    expect(await fails(saveExpense(db.web, owner, { category: 'Other', amount: '1' }, '00000000-0000-0000-0000-000000000000'))).toBeInstanceOf(ValidationError);
  });

  it('exports a spreadsheet that cannot run a vendor name as a formula', async () => {
    await saveExpense(db.web, owner, { category: 'Other', amount: '10', vendor: '=HYPERLINK("http://x")' });
    const csv = toCsv(EXPENSE_COLUMNS, (await listExpenses(db.web, owner)).rows as any[]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('Date,Vendor,Category,Amount paid,GST included,Paid by,Notes');
  });

  it('lets staff write, the accountant read only, and keeps businesses apart', async () => {
    const { id } = await saveExpense(db.web, staff, { category: 'Other', amount: '50' });
    expect(await getExpense(db.web, accountant, id)).toMatchObject({ category: 'Other' });
    expect((await listExpenses(db.web, accountant)).rows.length).toBeGreaterThan(0);
    expect(await fails(saveExpense(db.web, accountant, { category: 'Other', amount: '1' }))).toBeInstanceOf(ForbiddenError);
    expect(await fails(deleteExpense(db.web, accountant, id))).toBeInstanceOf(ForbiddenError);
    expect(await getExpense(db.web, other, id)).toBeNull();
    expect((await listExpenses(db.web, other)).rows).toHaveLength(0);
    expect(await fails(deleteExpense(db.web, other, id))).toBeInstanceOf(ValidationError);
    expect(await getExpense(db.web, owner, id)).not.toBeNull();
  });
});

describe('receipts', () => {
  it('stores a photo or a PDF, returns the same bytes, replaces and removes it', async () => {
    const { id } = await saveExpense(db.web, owner, { category: 'Other', amount: '20' });
    expect(await getReceipt(db.web, owner, id)).toBeNull();
    await setReceipt(db.web, owner, id, { name: 'bill photo.png', type: 'image/png', dataBase64: png.toString('base64') });
    const r = (await getReceipt(db.web, accountant, id))!;
    expect(r.type).toBe('image/png');
    expect(Buffer.compare(r.data, png)).toBe(0);
    expect((await listExpenses(db.web, owner)).rows.find((x) => x.id === id)).toMatchObject({ has_receipt: true });
    await setReceipt(db.web, owner, id, { name: 'bill.pdf', type: 'application/pdf', dataBase64: pdf.toString('base64') });
    expect((await getReceipt(db.web, owner, id))!.type).toBe('application/pdf');
    await setReceipt(db.web, staff, id, { name: 'x.jpg', type: 'image/jpeg', dataBase64: jpg.toString('base64') });
    await removeReceipt(db.web, owner, id);
    expect(await getReceipt(db.web, owner, id)).toBeNull();
  });

  it('refuses the wrong type, a file that is not what it claims, an empty or oversized file, and other businesses', async () => {
    const { id } = await saveExpense(db.web, owner, { category: 'Other', amount: '20' });
    const put = (f: { name: string; type: string; dataBase64: string }, t = owner) => setReceipt(db.web, t, id, f);
    expect(await fails(put({ name: 'a.exe', type: 'application/x-msdownload', dataBase64: 'AAAA' }))).toBeInstanceOf(ValidationError);
    expect(await fails(put({ name: 'a.png', type: 'image/png', dataBase64: pdf.toString('base64') }))).toBeInstanceOf(ValidationError);      // a PDF renamed as a picture
    expect(await fails(put({ name: 'a.pdf', type: 'application/pdf', dataBase64: png.toString('base64') }))).toBeInstanceOf(ValidationError);
    expect(await fails(put({ name: 'a.png', type: 'image/png', dataBase64: '' }))).toBeInstanceOf(ValidationError);
    expect(await fails(put({ name: 'a.png', type: 'image/png', dataBase64: 'not base64 !!' }))).toBeInstanceOf(ValidationError);
    const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await fails(put({ name: 'big.png', type: 'image/png', dataBase64: big.toString('base64') }))).message).toMatch(/larger than 2 MB/);
    expect(await fails(put({ name: 'a.png', type: 'image/png', dataBase64: png.toString('base64') }, accountant))).toBeInstanceOf(ForbiddenError);
    expect(await fails(put({ name: 'a.png', type: 'image/png', dataBase64: png.toString('base64') }, other))).toBeInstanceOf(ValidationError);
    expect(await getReceipt(db.web, owner, id)).toBeNull();
  });

  it('is deleted with its expense, and its contents never reach the audit log', async () => {
    const { id } = await saveExpense(db.web, owner, { category: 'Other', amount: '20' });
    await setReceipt(db.web, owner, id, { name: 'a.png', type: 'image/png', dataBase64: png.toString('base64') });
    await deleteExpense(db.web, owner, id);
    expect((await db.owner`select count(*)::int as n from expense_receipt where expense_id = ${id}`)[0]!.n).toBe(0);
    expect((await db.owner`select count(*)::int as n from audit_log where table_name = 'expense_receipt'`)[0]!.n).toBe(0);
    expect((await db.owner`select count(*)::int as n from audit_log where table_name = 'expense' and row_id = ${id}`)[0]!.n).toBeGreaterThan(0);
  });
});
