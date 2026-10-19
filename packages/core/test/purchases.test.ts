import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { gstinCheckChar } from '@kora/tax';
import {
  acceptGstr2bEntry, addMember, cancelBill, createBill, createBusiness, createParty, getBill, gstr3b, importGstr2b, itcSummary, listBills, normaliseInvoiceNumber, parseGstr2b,
  payBill, payablesAgeing, reconcileGstr2b, removeBillPayment, resolveTenant, setItcStatus, type TenantSession,
} from '../src/index.js';

const gstinFor = (state: string, pan: string, n: string) => { const b = `${state}${pan}${n}A1Z`; return b + gstinCheckChar(b); };
const G_VENDOR_A = gstinFor('24', 'AAACV', '1111');   // Gujarat
const G_VENDOR_B = gstinFor('27', 'AAACW', '2222');   // Maharashtra, same state as the buyer
let db: TestDb;
let owner: TenantSession, staff: TenantSession, ca: TenantSession, other: TenantSession;
let vA: string, vB: string, vNoGstin: string, customer: string;
const line = (rate: string, bp = 1800, over: Record<string, unknown> = {}) => ({ description: 'Goods', hsnSac: '8471', quantity: '1', rate, taxRateBp: bp, ...over });

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, c, x] = [await mk('o@e.test'), await mk('s@e.test'), await mk('c@e.test'), await mk('x@e.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Buyer Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  vA = await createParty(db.web, owner, { kind: 'vendor', name: 'Gujarat Steel', gstin: G_VENDOR_A, stateCode: '24' });
  vB = await createParty(db.web, owner, { kind: 'vendor', name: 'Local Paper', gstin: G_VENDOR_B, stateCode: '27' });
  vNoGstin = await createParty(db.web, owner, { kind: 'vendor', name: 'Village Transport', stateCode: '27' });
  customer = await createParty(db.web, owner, { kind: 'customer', name: 'A Customer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('recording a bill', () => {
  it('splits tax by the vendor\'s state: IGST across states, CGST and SGST inside', async () => {
    const a = await createBill(db.web, ca, { partyId: vA, billNumber: 'GS/0001', billDate: '2026-10-05', lines: [line('10000')] });
    expect(a.totalPaise).toBe('1180000');
    const bill = (await getBill(db.web, ca, a.id))!;
    expect(bill.bill).toMatchObject({ supply: 'inter', taxablePaise: '1000000', igstPaise: '180000', cgstPaise: '0', sgstPaise: '0', totalPaise: '1180000', itcStatus: 'eligible', status: 'recorded' });
    expect(bill.lines).toHaveLength(1);
    const b = await createBill(db.web, staff, { partyId: vB, billNumber: 'LP-77', billDate: '2026-10-06', lines: [line('2000'), line('500', 500)] });
    const bb = (await getBill(db.web, owner, b.id))!;
    expect(bb.bill).toMatchObject({ supply: 'intra', taxablePaise: '250000', cgstPaise: '19250', sgstPaise: '19250', igstPaise: '0' });   // 18% on 2000, 5% on 500
    expect(bb.bill.totalPaise).toBe('288500');
  });
  it('refuses a customer as vendor, a repeated number, bad dates and empty bills; keeps roles apart', async () => {
    await expect(createBill(db.web, owner, { partyId: customer, billNumber: 'X1', billDate: '2026-10-01', lines: [line('1')] })).rejects.toThrow(/Choose a vendor/);
    await expect(createBill(db.web, owner, { partyId: vA, billNumber: 'gs/0001', billDate: '2026-10-01', lines: [line('1')] })).rejects.toThrow(/already recorded a bill with that number/);
    await expect(createBill(db.web, owner, { partyId: vA, billNumber: 'N1', billDate: '01-10-2026', lines: [line('1')] })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(createBill(db.web, owner, { partyId: vA, billNumber: 'N2', billDate: '2026-10-01', lines: [] })).rejects.toThrow(/at least one line/);
    await expect(createBill(db.web, owner, { partyId: vA, billNumber: 'N3', billDate: '2026-10-01', lines: [line('1', 1700)] })).rejects.toThrow(/Line 1/);
    await expect(createBill(db.web, owner, { partyId: vA, billNumber: 'N4', billDate: '2026-10-01', lines: [line('1', 1800, { hsnSac: '12' })] })).rejects.toThrow(/HSN or SAC/);
    await expect(createBill(db.web, other, { partyId: vA, billNumber: 'N5', billDate: '2026-10-01', lines: [line('1')] })).rejects.toThrow(/Choose a vendor/);
    expect(await listBills(db.web, other)).toEqual([]);
  });
  it('under reverse charge the vendor is owed the taxable value only', async () => {
    const r = await createBill(db.web, owner, { partyId: vNoGstin, billNumber: 'VT-9', billDate: '2026-10-08', reverseCharge: true, lines: [line('5000', 500, { hsnSac: '9965' })] });
    expect(r.totalPaise).toBe('500000');
    expect((await getBill(db.web, owner, r.id))!.bill).toMatchObject({ reverseCharge: true, cgstPaise: '12500', sgstPaise: '12500', totalPaise: '500000' });
  });
});

describe('paying vendors', () => {
  it('tracks part payments, refuses overpaying, and lists open and paid bills', async () => {
    const id = (await listBills(db.web, owner, { q: 'LP-77' }))[0]!.id as string;
    expect(await payBill(db.web, ca, id, { amount: '1000', method: 'upi', paidOn: '2026-10-10' })).toMatchObject({ duePaise: '188500' });
    await expect(payBill(db.web, owner, id, { amount: '5000' })).rejects.toThrow(/Only Rs 1885.00 is still due/);
    await expect(payBill(db.web, owner, id, { amount: '10', method: 'barter' })).rejects.toThrow(/how it was paid/);
    expect((await listBills(db.web, owner, { state: 'open' })).some((b) => b.id === id)).toBe(true);
    const pay = (await getBill(db.web, owner, id))!.payments[0]!;
    await removeBillPayment(db.web, owner, pay.id as string);
    expect((await getBill(db.web, owner, id))!.bill.paidPaise).toBe('0');
    await payBill(db.web, owner, id, { amount: '2885' });
    expect((await listBills(db.web, owner, { state: 'paid' })).map((b) => b.id)).toContain(id);
    expect((await listBills(db.web, owner, { state: 'open' })).map((b) => b.id)).not.toContain(id);
  });
  it('cancels a bill only when nothing was paid on it', async () => {
    const r = await createBill(db.web, owner, { partyId: vA, billNumber: 'GS/CANCEL', billDate: '2026-10-09', lines: [line('100')] });
    await payBill(db.web, owner, r.id, { amount: '10' });
    await expect(cancelBill(db.web, owner, r.id)).rejects.toThrow(/payments against it/);
    const pay = (await getBill(db.web, owner, r.id))!.payments[0]!;
    await removeBillPayment(db.web, owner, pay.id as string);
    await cancelBill(db.web, owner, r.id);
    expect((await getBill(db.web, owner, r.id))!.bill.status).toBe('cancelled');
    expect((await listBills(db.web, owner, { state: 'cancelled' })).map((b) => b.id)).toContain(r.id);
    // the number can be used again once it is cancelled
    await createBill(db.web, owner, { partyId: vA, billNumber: 'GS/CANCEL', billDate: '2026-10-09', lines: [line('100')] });
  });
  it('ages what is owed, from the due date or the bill date', async () => {
    const a = await payablesAgeing(db.web, ca);
    expect(BigInt(a.outstanding)).toBeGreaterThan(0n);
    expect(a.rows[0]!.days_late).toBeGreaterThan(0);
    expect(Object.keys(a.totals)).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
  });
});

describe('input tax credit', () => {
  it('adds up eligible credit by head, keeps reverse charge and blocked credit apart, and leaves out cancelled bills', async () => {
    const s = await itcSummary(db.web, ca, '2026-10');
    // GS/0001 igst 1,800; GS/CANCEL (second one) igst 18; LP-77 cgst/sgst 192.50 each; VT-9 is reverse charge 125 + 125
    expect(s.ordinary).toMatchObject({ igst: '181800', cgst: '19250', sgst: '19250' });
    expect(s.reverseCharge).toMatchObject({ taxable: '500000', cgst: '12500', sgst: '12500', igst: '0' });
    expect(s.blockedTotal).toBe('0');
    expect(s.has2b).toBe(false);
    const blockedId = (await listBills(db.web, owner, { q: 'GS/CANCEL' }))[0]!.id as string;
    await expect(setItcStatus(db.web, owner, blockedId, 'blocked')).rejects.toThrow(/Say why/);
    await setItcStatus(db.web, owner, blockedId, 'blocked', 'Personal use');
    const s2 = await itcSummary(db.web, ca, '2026-10');
    expect(s2.blocked).toMatchObject({ igst: '1800' });
    expect(s2.ordinary.igst).toBe('180000');
    expect(s2.blockedBills[0]).toMatchObject({ billNumber: 'GS/CANCEL', reason: 'Personal use' });
    await setItcStatus(db.web, owner, blockedId, 'eligible');
    expect((await itcSummary(db.web, ca, '2026-10')).ordinary.igst).toBe('181800');
    await expect(itcSummary(db.web, ca, '2026-13')).rejects.toThrow(/YYYY-MM/);
  });
});

describe('GSTR-2B', () => {
  const file = (invs: Record<string, unknown>[]) => ({ data: { docdata: { b2b: [{ ctin: G_VENDOR_A, trdnm: 'Gujarat Steel Pvt Ltd', inv: invs }, { ctin: G_VENDOR_B, trdnm: 'Local Paper', inv: [
    { inum: 'LP-77', dt: '06-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 2500, rt: 18, cgst: 192.5, sgst: 192.5, igst: 0, cess: 0 }] },
    { inum: 'LP-999', dt: '12-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 1000, rt: 18, cgst: 90, sgst: 90 }] },
  ] }] } } });
  const inv = [
    { inum: 'gs-0001', dt: '05-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 10000, rt: 18, igst: 1800 }] },
    { inum: 'GS/0002', dt: '20-10-2026', itcavl: 'N', rev: 'N', items: [{ txval: 400, rt: 18, igst: 72 }] },
  ];

  it('reads the portal\'s JSON, adding up items and converting rupees to paise', () => {
    const e = parseGstr2b(file(inv));
    expect(e).toHaveLength(4);
    expect(e[0]).toMatchObject({ gstin: G_VENDOR_A, number: 'gs-0001', date: '2026-10-05', taxable: 1000000n, igst: 180000n, itc: true, rcm: false });
    expect(e[1]).toMatchObject({ itc: false });
    expect(parseGstr2b({ data: { docdata: { b2b: [{ ctin: G_VENDOR_A, inv: [{ inum: 'A', dt: '01-10-2026', itms: [{ num: 1, itm_det: { txval: 100.5, iamt: 18.09 } }] }] }] } } })[0]).toMatchObject({ taxable: 10050n, igst: 1809n });
    expect(() => parseGstr2b({ nope: true })).toThrow(/does not look like a GSTR-2B/);
    expect(normaliseInvoiceNumber('INV/00012')).toBe(normaliseInvoiceNumber('inv-12'));
    expect(normaliseInvoiceNumber('0012')).toBe('12');
    expect(normaliseInvoiceNumber('A-100')).toBe('A100');
  });

  it('loads a statement, matches it to bills by supplier and number, and loading it twice changes nothing', async () => {
    const r1 = await importGstr2b(db.web, ca, '2026-10', file(inv));
    expect(r1).toMatchObject({ entries: 4, added: 4, matched: 2 });
    const r2 = await importGstr2b(db.web, ca, '2026-10', file(inv));
    expect(r2).toMatchObject({ added: 0, updated: 4, matched: 2 });
    expect((await getBill(db.web, owner, (await listBills(db.web, owner, { q: 'GS/0001' }))[0]!.id as string))!.in2b).toMatchObject({ period: '2026-10' });
    await expect(importGstr2b(db.web, ca, '2026-10', { data: { docdata: { b2b: [] } } })).rejects.toThrow(/no supplier invoices/);
  });

  it('reconciles: matched, differing, only in the statement, only in the books', async () => {
    await createBill(db.web, owner, { partyId: vA, billNumber: 'GS/0003', billDate: '2026-10-25', lines: [line('300')] });   // in books, not in 2B
    const r = await reconcileGstr2b(db.web, ca, '2026-10');
    expect(r.counts).toEqual({ matched: 2, mismatched: 0, onlyIn2b: 2, onlyInBooks: 2 });
    expect((r.onlyIn2b as { invoiceNumber: string }[]).map((x) => x.invoiceNumber).sort()).toEqual(['GS/0002', 'LP-999']);
    expect((r.onlyInBooks as { billNumber: string }[]).map((b) => b.billNumber).sort()).toEqual(['GS/0003', 'GS/CANCEL']);
    // an amount that differs by more than a rupee shows up with the difference (2B minus books)
    await importGstr2b(db.web, ca, '2026-10', file([{ inum: 'gs-0001', dt: '05-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 10000, rt: 18, igst: 1700 }] }]));
    const r2 = await reconcileGstr2b(db.web, ca, '2026-10');
    expect(r2.counts.mismatched).toBe(1);
    expect((r2.mismatched as { differences: Record<string, string> }[])[0]!.differences).toEqual({ igst: '-10000' });
    await importGstr2b(db.web, ca, '2026-10', file([{ inum: 'gs-0001', dt: '05-10-2026', itcavl: 'Y', rev: 'N', items: [{ txval: 10000, rt: 18, igst: 1800.5 }] }]));
    expect((await reconcileGstr2b(db.web, ca, '2026-10')).counts.mismatched).toBe(0);   // within Rs 1
  });

  it('marks eligible bills missing from the statement as at risk', async () => {
    const s = await itcSummary(db.web, ca, '2026-10');
    expect(s.has2b).toBe(true);
    expect(s.atRiskBills.map((b) => b.billNumber).sort()).toEqual(['GS/0003', 'GS/CANCEL']);
    expect(s.atRisk.igst).toBe('7200');         // 54.00 on GS/0003 and 18.00 on the second GS/CANCEL
    expect(s.atRiskTotal).toBe('7200');
  });

  it('turns a statement line you do not have into a bill, creating the vendor if needed', async () => {
    const r = await reconcileGstr2b(db.web, ca, '2026-10');
    const lp = (r.onlyIn2b as { entryId: string; invoiceNumber: string }[]).find((x) => x.invoiceNumber === 'LP-999')!;
    const { billId } = await acceptGstr2bEntry(db.web, ca, lp.entryId);
    const b = (await getBill(db.web, ca, billId))!;
    expect(b.bill).toMatchObject({ billNumber: 'LP-999', vendor: 'Local Paper', supply: 'intra', taxablePaise: '100000', cgstPaise: '9000', totalPaise: '118000' });
    await expect(acceptGstr2bEntry(db.web, ca, lp.entryId)).rejects.toThrow(/already matched/);
    const gs2 = (r.onlyIn2b as { entryId: string; invoiceNumber: string }[]).find((x) => x.invoiceNumber === 'GS/0002')!;
    const blocked = (await getBill(db.web, ca, (await acceptGstr2bEntry(db.web, ca, gs2.entryId)).billId))!;
    expect(blocked.bill).toMatchObject({ itcStatus: 'blocked', itcReason: 'Marked not available in GSTR-2B' });
    expect((await reconcileGstr2b(db.web, ca, '2026-10')).counts.onlyIn2b).toBe(0);
  });

  it('is private to the business', async () => {
    await expect(reconcileGstr2b(db.web, other, '2026-10')).resolves.toMatchObject({ loaded: 0 });
    expect((await itcSummary(db.web, other, '2026-10')).billCount).toBe(0);
  });
});

describe('GSTR-3B with purchases', () => {
  it('carries reverse charge, input credit and what is left to pay in cash', async () => {
    const [x] = await db.web`select 1`;
    void x;
    const doc = await import('../src/index.js');
    // one sale in the same month: Rs 50,000 taxable, 18% GST inside the state
    const draft = await doc.saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-10-15', lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate: '50000', taxRateBp: 1800, kind: 'service' }] });
    await doc.issueDocument(db.web, owner, draft.id);
    const r = await gstr3b(db.web, ca, '2026-10');
    const rc = r.json.sup_details.isup_rev;
    expect(rc).toMatchObject({ txval: 5000, camt: 125, samt: 125 });
    const net = r.json.itc_elg.itc_net;
    expect(Number(net.iamt)).toBeGreaterThan(0);
    expect(Number(net.camt)).toBeGreaterThan(0);
    expect(r.table4).toHaveLength(3);
    // liability = sales tax 9,000 + reverse charge 250; credit = everything eligible
    expect(BigInt(r.liability.total)).toBe(900000n + 25000n);
    expect(BigInt(r.payableInCash)).toBe(BigInt(r.liability.total) - (BigInt(r.netItc.igst) + BigInt(r.netItc.cgst) + BigInt(r.netItc.sgst) + BigInt(r.netItc.cess)));
    expect(r.itcAtRisk).toBe('7200');
    expect(r.notes.some((n: string) => /Table 4 is filled/.test(n))).toBe(true);
  });
});
