import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  auditLog, changeRole, createBusiness, createParty, customerStatement, dateRange, inviteMember, issueDocument, listBusinesses, listMembers,
  paymentsReceived, recordPayment, removeMember, resolveTenant, salesByCustomer, salesRegister, saveDraft, toCsv, ForbiddenError, ValidationError,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let cust: string, cust2: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const mk = async (date: string, rate: string, partyId: string | null = cust, docType: 'tax_invoice' | 'credit_note' = 'tax_invoice', extra: object = {}) =>
  (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, { docType, partyId, docDate: date, lines: [{ name: 'x', hsnSac: '8471', quantity: '1', rate, taxRateBp: 1800 }], ...extra })).id)).document;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27' });
  cust2 = await createParty(db.web, owner, { kind: 'customer', name: '=HYPERLINK("http://evil.example","pay")', stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('team', () => {
  it('invites by phone or email, lists members, and the invitee gets the right access', async () => {
    const a = await inviteMember(db.web, owner, { identifier: '98765 43210', role: 'staff' });
    expect(a.identifier).toBe('+919876543210');
    await inviteMember(db.web, owner, { identifier: 'CA@Example.test', role: 'accountant' });
    const ms = await listMembers(db.web, owner);
    expect(ms.map((m) => [m.role, m.phone ?? m.email])).toEqual([['owner', 'own@example.test'], ['staff', '+919876543210'], ['accountant', 'ca@example.test']]);
    const staff = await resolveTenant(db.web, a.userId, owner.businessId);
    expect(staff.role).toBe('staff');
    await expect(inviteMember(db.web, staff, { identifier: '9123456789', role: 'staff' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listBusinesses(db.web, a.userId))).toHaveLength(1);
  });
  it('a person who already has an account keeps it; a repeat invite is refused', async () => {
    const [u] = await db.owner`insert into app_user (phone) values ('+919000000001') returning id`;
    const r = await inviteMember(db.web, owner, { identifier: '9000000001', role: 'accountant' });
    expect(r.userId).toBe(u!.id);
    expect((await fails(inviteMember(db.web, owner, { identifier: '9000000001', role: 'staff' }))).message).toMatch(/already a member/);
    expect(await fails(inviteMember(db.web, owner, { identifier: '123', role: 'staff' }))).toBeInstanceOf(Error);
    expect(await fails(inviteMember(db.web, owner, { identifier: '9000000002', role: 'admin' }))).toBeInstanceOf(ValidationError);
  });
  it('roles can be changed and members removed, but never the last owner', async () => {
    const ms = await listMembers(db.web, owner);
    const staff = ms.find((m) => m.role === 'staff')!;
    await changeRole(db.web, owner, staff.userId, 'accountant');
    expect((await listMembers(db.web, owner)).find((m) => m.userId === staff.userId)!.role).toBe('accountant');
    await removeMember(db.web, owner, staff.userId);
    expect((await listMembers(db.web, owner)).some((m) => m.userId === staff.userId)).toBe(false);
    expect((await fails(changeRole(db.web, owner, owner.userId, 'staff'))).message).toMatch(/at least one owner/);
    expect((await fails(removeMember(db.web, owner, owner.userId))).message).toMatch(/at least one owner/);
  });
  it('a removed member loses access at once', async () => {
    const r = await inviteMember(db.web, owner, { identifier: '9111111111', role: 'staff' });
    const t = await resolveTenant(db.web, r.userId, owner.businessId);
    await removeMember(db.web, owner, r.userId);
    await expect(resolveTenant(db.web, r.userId, owner.businessId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMembers(db.web, t)).resolves.toEqual([]);   // RLS: even a stale session sees nothing
  });
});

describe('audit log', () => {
  it('shows who did what, including automatic work, to owners and accountants', async () => {
    const d = await mk('2026-10-10', '1000');
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash', receivedOn: '2026-10-11' });
    const log = await auditLog(db.web, owner, { table: 'payment' });
    expect(log[0]).toMatchObject({ table_name: 'payment', action: 'INSERT', actor: 'own@example.test' });
    const ms = await listMembers(db.web, owner);
    const acct = ms.find((m) => m.role === 'accountant')!;
    const t = await resolveTenant(db.web, acct.userId, owner.businessId);
    expect((await auditLog(db.web, t, { rowId: d.id as string })).length).toBeGreaterThan(0);
    const [s] = await db.owner`select id from app_user where phone = '+919000000001'`;
    expect(s).toBeDefined();
  });
  it('staff cannot read it', async () => {
    const r = await inviteMember(db.web, owner, { identifier: '9222222222', role: 'staff' });
    const staff = await resolveTenant(db.web, r.userId, owner.businessId);
    await expect(auditLog(db.web, staff)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('registers', () => {
  it('sales register lists documents with credit notes negative, and totals only issued ones', async () => {
    await mk('2026-11-05', '2000');
    const inv = await mk('2026-11-06', '1000');
    const { startNote } = await import('../src/index.js');
    const n = await startNote(db.web, owner, inv.id as string, 'credit_note');
    await saveDraft(db.web, owner, { docType: 'credit_note', partyId: cust, originalDocumentId: inv.id as string, docDate: '2026-11-07', lines: [{ name: 'x', hsnSac: '8471', quantity: '1', rate: '400', taxRateBp: 1800 }] }, n.id);
    await issueDocument(db.web, owner, n.id);
    const bad = await mk('2026-11-08', '999');
    const { cancelDocument } = await import('../src/index.js');
    await cancelDocument(db.web, owner, bad.id as string, 'mistake');
    const r = await salesRegister(db.web, owner, { from: '2026-11-01', to: '2026-11-30' });
    expect(r.rows.map((x) => [x.type, x.status, x.total])).toEqual([['Tax invoice', 'Issued', '236000'], ['Tax invoice', 'Issued', '118000'], ['Credit note', 'Issued', '-47200'], ['Tax invoice', 'Cancelled', '117900']]);
    expect(r.totals).toEqual({ taxable: '260000', cgst: '23400', sgst: '23400', igst: '0', cess: '0', total: '306800', count: 3 });
  });
  it('sales by customer nets credit notes and shows what is outstanding', async () => {
    await mk('2026-12-02', '500', cust2);
    const r = await salesByCustomer(db.web, owner, { from: '2026-11-01', to: '2026-12-31' });
    const v = r.rows.find((x) => x.customer === 'Verma Stores')!;
    expect(v).toMatchObject({ documents: 3, total: '306800', outstanding: '354000' });   // 3600 billed, less nothing paid; the credit note reduces net sales
    expect(r.rows.find((x) => x.customer.startsWith('=HYPER'))!.total).toBe('59000');
  });
  it('payments received shows how each payment was applied', async () => {
    const d = await mk('2026-12-10', '1000', cust);
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '500', method: 'upi', receivedOn: '2026-12-12', note: 'UTR 99' });
    const r = await paymentsReceived(db.web, owner, { from: '2026-12-01', to: '2026-12-31' });
    expect(r.rows).toEqual([expect.objectContaining({ received_on: '2026-12-12', customer: 'Verma Stores', method: 'upi', invoices: d.number, amount: '50000', unallocated: '0', reference: 'UTR 99' })]);
    expect(r.total).toBe('50000');
  });
  it('a customer statement runs a balance through bills, credit notes and payments', async () => {
    // Before December: 1,180 billed in October less 100 received, 2,360 and 1,180 billed in November, less a 472 credit note.
    const s = await customerStatement(db.web, owner, cust, { from: '2026-12-01', to: '2026-12-31' });
    expect(s.opening).toBe('414800');
    expect(s.rows.map((r) => [r.description.replace(/ INV.*/, ''), r.debit, r.credit, r.balance])).toEqual([
      ['Tax invoice', '118000', '0', '532800'], ['Payment (upi)', '0', '50000', '482800']]);
    expect(s.closing).toBe('482800');
    const all = await customerStatement(db.web, owner, cust, { from: '2026-01-01', to: '2026-12-31' });
    expect(all).toMatchObject({ opening: '0', closing: '482800' });
    expect(all.rows).toHaveLength(7);
    const early = await customerStatement(db.web, owner, cust, { from: '2026-10-01', to: '2026-10-31' });
    expect(early.closing).toBe('108000');   // the November and December entries are not counted yet
    expect(await fails(customerStatement(db.web, owner, '00000000-0000-0000-0000-000000000099'))).toBeInstanceOf(ValidationError);
  });
  it('date ranges are validated', () => {
    expect(() => dateRange({ from: '2026-12-31', to: '2026-12-01' }, 'Asia/Kolkata')).toThrow(/after the end date/);
    expect(() => dateRange({ from: 'soon' }, 'Asia/Kolkata')).toThrow(ValidationError);
    expect(dateRange({ to: '2026-10-18' }, 'Asia/Kolkata')).toEqual({ from: '2026-10-01', to: '2026-10-18' });
  });
});

describe('CSV', () => {
  it('escapes quotes and breaks, formats rupees, and defuses spreadsheet formulas', () => {
    const csv = toCsv([{ key: 'name', label: 'Name' }, { key: 'amt', label: 'Amount', money: true }, { key: 'note', label: 'Note' }],
      [{ name: '=HYPERLINK("x")', amt: '118000', note: 'a, b' }, { name: '+91 98765', amt: '-5', note: 'line1\nline2' }, { name: 'Normal "Co"', amt: '5', note: null }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.split('\r\n')).toEqual([
      '﻿Name,Amount,Note', '"\'=HYPERLINK(""x"")",1180.00,"a, b"', '\'+91 98765,-0.05,"line1\nline2"', '"Normal ""Co""",0.05,', '']);
  });
});
