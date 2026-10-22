import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addPartyNote, addMember, cleanTags, createBill, createBusiness, createContactPerson, createParty, customerStatement, findDuplicateParties, issueDocument, listPartyNotes, mergeParties,
  partiesExport, partyCreditStatus, partyOverview, recordAdvance, recordPayment, removePartyNote, resolveTenant, saveDraft, setPartyExtras, toCsv, PARTY_EXPORT_COLUMNS,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const invoice = async (partyId: string, rate: string) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId, docDate: '2026-10-01', dueDate: '2026-10-20', lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] });
  await issueDocument(db.web, owner, id);
  return id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const [s] = await db.owner`insert into app_user (email) values ('s@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u!.id as string, bid, s!.id as string, 'staff');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  staff = await resolveTenant(db.web, s!.id as string, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('tags, credit limit and opening balance', () => {
  it('cleans tags and refuses silly ones', () => {
    expect(cleanTags([' Wholesale ', 'wholesale', 'Slow Payer'])).toEqual(['wholesale', 'slow-payer']);
    expect(() => cleanTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow(/at most 10/);
    expect(() => cleanTags(['a'.repeat(31)])).toThrow(/up to 30/);
  });
  it('saves them and leaves the rest alone', async () => {
    const id = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27', phone: '9876543210' });
    await setPartyExtras(db.web, owner, id, { tags: ['Wholesale'], creditLimit: '50000', openingBalance: '12000.50', openingBalanceOn: '2026-04-01' });
    const [r] = await db.owner`select tags, credit_limit_paise::text as l, opening_balance_paise::text as o, opening_balance_on::text as d from party where id = ${id}`;
    expect(r).toMatchObject({ tags: ['wholesale'], l: '5000000', o: '1200050', d: '2026-04-01' });
    await setPartyExtras(db.web, owner, id, { creditLimit: '' });
    const [r2] = await db.owner`select tags, credit_limit_paise, opening_balance_paise::text as o from party where id = ${id}`;
    expect(r2).toMatchObject({ tags: ['wholesale'], credit_limit_paise: null, o: '1200050' });
    expect((await fails(setPartyExtras(db.web, owner, id, { openingBalance: '100' }))).message).toMatch(/date of the opening balance/);
    expect((await fails(setPartyExtras(db.web, owner, id, { creditLimit: '-5' }))).message).toMatch(/cannot be negative/);
    await expect(setPartyExtras(db.web, staff, id, { tags: ['x'] })).resolves.toBeUndefined();
  });
  it('the credit status counts invoices, the opening balance and money held, and says when the limit is passed', async () => {
    const id = await createParty(db.web, owner, { kind: 'customer', name: 'Limit Co', stateCode: '27' });
    await setPartyExtras(db.web, owner, id, { creditLimit: '1000', openingBalance: '200', openingBalanceOn: '2026-04-01' });
    expect(await partyCreditStatus(db.web, owner, id)).toMatchObject({ limitPaise: '100000', owedPaise: '20000', availablePaise: '80000', over: false });
    await invoice(id, '900');
    expect(await partyCreditStatus(db.web, owner, id)).toMatchObject({ owedPaise: '110000', over: true });
    await recordAdvance(db.web, owner, { partyId: id, amount: '300', method: 'cash' });
    expect(await partyCreditStatus(db.web, owner, id)).toMatchObject({ owedPaise: '80000', over: false });
  });
  it('shows the opening balance on the statement, so the running balance starts from it', async () => {
    const id = await createParty(db.web, owner, { kind: 'customer', name: 'Opening Co', stateCode: '27' });
    await setPartyExtras(db.web, owner, id, { openingBalance: '500', openingBalanceOn: '2026-05-01' });
    await invoice(id, '250');
    const s = await customerStatement(db.web, owner, id, { from: '2026-04-01', to: '2026-12-31' });
    expect(s.rows[0]).toMatchObject({ description: 'Opening balance brought forward', debit: '50000', balance: '50000' });
    expect(s.closing).toBe('75000');
  });
});

describe('notes', () => {
  it('keeps a dated log, and only the writer or an owner can remove one', async () => {
    const id = await createParty(db.web, owner, { kind: 'customer', name: 'Noted Co', stateCode: '27' });
    const n = await addPartyNote(db.web, staff, id, 'Prefers WhatsApp, pays on the 10th.');
    await addPartyNote(db.web, owner, id, 'Asked for a discount.');
    const list = await listPartyNotes(db.web, owner, id);
    expect(list.map((x) => x.body)).toEqual(['Asked for a discount.', 'Prefers WhatsApp, pays on the 10th.']);
    const mine = await listPartyNotes(db.web, staff, id);
    expect(mine.find((x) => x.id === n.id)!.mine).toBe(true);
    await expect(removePartyNote(db.web, staff, id, list[0]!.id)).rejects.toThrow(/Only the person who wrote/);
    await removePartyNote(db.web, owner, id, n.id);
    expect(await listPartyNotes(db.web, owner, id)).toHaveLength(1);
    expect((await fails(addPartyNote(db.web, owner, id, '  '))).message).toMatch(/Note/);
  });
});

describe('duplicates and merging', () => {
  let keep: string, dupe: string, dupeInvoice: string;
  it('finds parties that look the same', async () => {
    keep = await createParty(db.web, owner, { kind: 'customer', name: 'Sharma Traders Pvt Ltd', stateCode: '27', phone: '9811111111' });
    dupe = await createParty(db.web, owner, { kind: 'vendor', name: 'Sharma Traders', stateCode: '27', phone: '+91 98111 11111', email: 'a@sharma.test' });
    const groups = await findDuplicateParties(db.web, owner);
    const g = groups.filter((x) => x.parties.some((p) => p.id === keep));
    expect(g.map((x) => x.reason)).toEqual(['Same mobile number and same name']);
    expect(g[0]!.parties.map((p) => p.id).sort()).toEqual([keep, dupe].sort());
  });
  it('folds the duplicate in: movable things move, issued documents stay but still count', async () => {
    dupeInvoice = await invoice(dupe, '1000');
    await recordPayment(db.web, owner, { documentId: dupeInvoice, amount: '400', method: 'cash' });
    const draft = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: dupe, docDate: '2026-10-02', lines: [{ name: 'Later', hsnSac: '998313', quantity: '1', rate: '10', taxRateBp: 0, kind: 'service' }] })).id;
    await createContactPerson(db.web, owner, dupe, { name: 'Ravi', email: 'ravi@sharma.test' });
    await setPartyExtras(db.web, owner, dupe, { tags: ['vendor-too'], openingBalance: '100', openingBalanceOn: '2026-04-01' });
    await createBill(db.web, owner, { partyId: dupe, billNumber: 'SH-1', billDate: '2026-10-03', lines: [{ description: 'Goods', quantity: '1', rate: '100', taxRateBp: 0 }] });
    const r = await mergeParties(db.web, owner, keep, dupe);
    expect(r.moved).toMatchObject({ drafts: 1, payments: 1, bills: 1, contacts: 1 });
    const [k] = await db.owner`select kind, email, tags, opening_balance_paise::text as o from party where id = ${keep}`;
    expect(k).toMatchObject({ kind: 'both', email: 'a@sharma.test', tags: ['vendor-too'], o: '10000' });
    const [d] = await db.owner`select archived_at, merged_into from party where id = ${dupe}`;
    expect(d!.archived_at).not.toBeNull(); expect(d!.merged_into).toBe(keep);
    const [dd] = await db.owner`select party_id from document where id = ${draft}`;
    expect(dd!.party_id).toBe(keep);
    const [issued] = await db.owner`select party_id from document where id = ${dupeInvoice}`;
    expect(issued!.party_id).toBe(dupe);   // issued documents are immutable
    const ov = await partyOverview(db.web, owner, keep);
    expect(ov!.summary.invoices).toBe(1);
    expect(ov!.summary.outstandingPaise).toBe('60000');
    const st = await customerStatement(db.web, owner, keep, { from: '2026-01-01', to: '2026-12-31' });
    expect(st.rows.map((x) => x.description)).toEqual(['Opening balance brought forward', expect.stringContaining('Tax invoice'), expect.stringContaining('Payment')]);
    expect(st.closing).toBe('70000');   // Rs 100 opening + 1000 invoice - 400 payment
    expect((await findDuplicateParties(db.web, owner)).filter((x) => x.parties.some((p) => p.id === dupe))).toEqual([]);
  });
  it('refuses to merge a party with itself or one that is already merged', async () => {
    expect((await fails(mergeParties(db.web, owner, keep, keep))).message).toMatch(/two different/);
    expect((await fails(mergeParties(db.web, owner, keep, dupe))).message).toMatch(/already been merged/);
    await expect(mergeParties(db.web, staff, keep, dupe)).rejects.toThrow();
  });
});

describe('export', () => {
  it('writes every active customer and vendor with the new columns, and leaves out the merged duplicate', async () => {
    const rows = await partiesExport(db.web, owner);
    expect(rows.find((r) => r.name === 'Sharma Traders')).toBeUndefined();
    const sharma = rows.find((r) => r.name === 'Sharma Traders Pvt Ltd')!;
    expect(sharma).toMatchObject({ type: 'both', tags: 'vendor-too', opening_balance: '100.00', opening_balance_on: '2026-04-01' });
    const csv = toCsv(PARTY_EXPORT_COLUMNS, rows);
    expect(csv.split('\n')[0]).toContain('Credit limit (Rs)');
    expect((await partiesExport(db.web, owner, { kind: 'vendor' })).every((r) => r.type !== 'customer')).toBe(true);
  });
});

describe('import reads the new columns back', () => {
  it('creates vendors with tags, limit, opening balance and Udyam from the same columns the export writes', async () => {
    const { previewImport, commitImport } = await import('../src/index.js');
    const csv = ['Name,Type,Tags,Credit limit (Rs),Opening balance (Rs),Opening balance date,Udyam number,MSME size',
      'Round Trip Vendor,vendor,"steel, local",5000,-250.50,2026-04-01,UDYAM-MH-12-0001234,small',
      'Bad Type Co,friend,,,,,,',
      'No Date Co,customer,,,100,,,'].join('\n');
    const p = await previewImport(db.web, owner, 'customers', csv);
    expect(p.counts).toMatchObject({ ok: 1, error: 2 });
    const msgs = p.rows.filter((r) => r.status === 'error').map((r) => r.message).join(' ');
    expect(msgs).toMatch(/should be customer, vendor or both/);
    expect(msgs).toMatch(/opening balance needs its date/);
    const r = await commitImport(db.web, owner, 'customers', csv);
    expect(r.created).toBe(1);
    const [v] = await db.owner`select kind, tags, credit_limit_paise::text as l, opening_balance_paise::text as o, udyam_number, msme_class from party where name = 'Round Trip Vendor'`;
    expect(v).toMatchObject({ kind: 'vendor', tags: ['steel', 'local'], l: '500000', o: '-25050', udyam_number: 'UDYAM-MH-12-0001234', msme_class: 'small' });
  });
});
