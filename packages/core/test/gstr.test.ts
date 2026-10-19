import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, cancelDocument, createBusiness, createParty, gstr1, gstSummary, issueDocument, periodBounds, resolveTenant, saveDraft, startNote,
  ForbiddenError, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession;
let regKA: string, regMH: string, unregKA: string;
const gstin = (state: string, pan: string) => { const b = `${state}${pan}1Z`; return b + gstinCheckChar(b); };
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const line = (rate: string, bp: number, qty = '1', hsn = '847130') => ({ name: 'Item ' + hsn, hsnSac: hsn, quantity: qty, rate, taxRateBp: bp, unit: 'NOS' });
const mk = async (docType: DocIn['docType'], partyId: string | null, lines: DocIn['lines'], date = '2026-10-10', extra: Partial<DocIn> = {}) =>
  (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, { docType, partyId, docDate: date, lines, ...extra })).id)).document;
const paise = (x: unknown) => BigInt(Math.round(Number(x) * 100));
const rs = (x: bigint) => Number(x) / 100;

let invA: any, invD: any;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const [s] = await db.owner`insert into app_user (email) values ('st@example.test') returning id`;
  const [a] = await db.owner`insert into app_user (email) values ('ac@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: gstin('27', 'AAPFU0939F'), stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u!.id as string, bid, s!.id as string, 'staff');
  await addMember(db.web, u!.id as string, bid, a!.id as string, 'accountant');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  staff = await resolveTenant(db.web, s!.id as string, bid);
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  regKA = await createParty(db.web, owner, { kind: 'customer', name: 'Reg KA', gstin: gstin('29', 'BBBCC1234D') });
  regMH = await createParty(db.web, owner, { kind: 'customer', name: 'Reg MH', gstin: gstin('27', 'CCCCC1234D') });
  unregKA = await createParty(db.web, owner, { kind: 'customer', name: 'Unreg KA', stateCode: '29' });

  invA = await mk('tax_invoice', regMH, [line('10000', 1800)]);                                   // B2B intra
  await mk('tax_invoice', regKA, [line('5000', 500, '1', '1001'), line('20000', 1800), line('1000', 0, '1', '2201')]); // B2B inter, 3 lines
  await mk('tax_invoice', null, [line('1000', 1800), line('2000', 1200, '1', '6203')]);           // B2C intra, walk-in
  invD = await mk('tax_invoice', unregKA, [line('500', 1800)]);                                   // B2C inter small
  await mk('tax_invoice', unregKA, [line('100000', 1800, '3')]);                                  // B2CL
  await mk('tax_invoice', regKA, [line('4000', 1800)], '2026-10-11', { reverseCharge: true });    // reverse charge
  await mk('bill_of_supply', null, [line('700', 0, '1', '0409')]);                                // exempt
  const cnA = await startNote(db.web, owner, invA.id, 'credit_note');
  await saveDraft(db.web, owner, { docType: 'credit_note', partyId: regMH, originalDocumentId: invA.id, docDate: '2026-10-12', lines: [line('5000', 1800)] }, cnA.id);
  await issueDocument(db.web, owner, cnA.id);
  const dnA = await startNote(db.web, owner, invA.id, 'debit_note');
  await saveDraft(db.web, owner, { docType: 'debit_note', partyId: regMH, originalDocumentId: invA.id, docDate: '2026-10-13', lines: [line('1000', 1800)] }, dnA.id);
  await issueDocument(db.web, owner, dnA.id);
  const cnD = await startNote(db.web, owner, invD.id, 'credit_note');
  await saveDraft(db.web, owner, { docType: 'credit_note', partyId: unregKA, originalDocumentId: invD.id, docDate: '2026-10-14', lines: [line('200', 1800)] }, cnD.id);
  await issueDocument(db.web, owner, cnD.id);
  const bad = await mk('tax_invoice', regMH, [line('99', 1800)], '2026-10-20');
  await cancelDocument(db.web, owner, bad.id as string, 'mistake');
  await mk('tax_invoice', regMH, [line('123456', 1800)], '2026-09-30');                           // other month
}, 120_000);
afterAll(async () => { await db?.drop(); });

describe('GSTR-1 data', () => {
  it('puts each supply in the right section', async () => {
    const r = await gstr1(db.web, owner, '2026-10');
    const j = r.json as any;
    expect(j).toMatchObject({ gstin: gstin('27', 'AAPFU0939F'), fp: '102026' });
    const b2b = Object.fromEntries(j.b2b.map((x: any) => [x.ctin, x.inv]));
    expect(Object.keys(b2b).sort()).toEqual([gstin('27', 'CCCCC1234D'), gstin('29', 'BBBCC1234D')].sort());
    const a = b2b[gstin('27', 'CCCCC1234D')][0];
    expect(a).toMatchObject({ inum: invA.number, idt: '10-10-2026', val: 11800, pos: '27', rchrg: 'N', inv_typ: 'R' });
    expect(a.itms).toEqual([{ num: 1, itm_det: { rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 } }]);
    const ka = b2b[gstin('29', 'BBBCC1234D')];
    const inter = ka.find((i: any) => i.rchrg === 'N');
    expect(inter.itms.map((i: any) => [i.itm_det.rt, i.itm_det.txval, i.itm_det.iamt])).toEqual([[5, 5000, 250], [18, 20000, 3600]]);   // the 0% line is nil-rated, not here
    expect(inter.val).toBe(29850);
    expect(ka.find((i: any) => i.rchrg === 'Y')).toBeDefined();
  });
  it('splits unregistered buyers into large inter-state invoices and consolidated small ones', async () => {
    const j = (await gstr1(db.web, owner, '2026-10')).json as any;
    expect(j.b2cl).toHaveLength(1);
    expect(j.b2cl[0]).toMatchObject({ pos: '29' });
    expect(j.b2cl[0].inv[0]).toMatchObject({ val: 354000 });
    expect(j.b2cl[0].inv[0].itms[0].itm_det).toEqual({ rt: 18, txval: 300000, iamt: 54000, csamt: 0 });
    const cs = Object.fromEntries(j.b2cs.map((x: any) => [`${x.sply_ty}|${x.pos}|${x.rt}`, x.txval]));
    expect(cs).toEqual({ 'INTRA|27|18': 1000, 'INTRA|27|12': 2000, 'INTER|29|18': 300 });  // 500 invoice less the 200 credit note
  });
  it('credit and debit notes go to the note sections', async () => {
    const j = (await gstr1(db.web, owner, '2026-10')).json as any;
    const nts = j.cdnr.find((x: any) => x.ctin === gstin('27', 'CCCCC1234D')).nt;
    expect(nts.map((n: any) => [n.ntty, n.itms[0].itm_det.txval, n.itms[0].itm_det.camt])).toEqual([['C', 5000, 450], ['D', 1000, 90]]);
    expect(nts[0]).toMatchObject({ nt_num: expect.stringMatching(/^CN\//), nt_dt: '12-10-2026', inv_typ: 'R' });
  });
  it('reports nil-rated and exempt supplies, the HSN summary and the number series', async () => {
    const j = (await gstr1(db.web, owner, '2026-10')).json as any;
    const nil = Object.fromEntries(j.nil.inv.map((x: any) => [x.sply_ty, [x.nil_amt, x.expt_amt]]));
    expect(nil).toEqual({ INTRB2B: [1000, 0], INTRAB2C: [0, 700] });
    const hsn = j.hsn.data.find((h: any) => h.hsn_sc === '847130' && h.rt === 18);
    expect(hsn.txval).toBeGreaterThan(0);
    const inv = j.doc_issue.doc_det.find((d: any) => d.doc_typ === 'Invoices for outward supply');
    const sum = (k: string) => inv.docs.reduce((n: number, d: any) => n + d[k], 0);
    expect([sum('totnum'), sum('cancel'), sum('net_issue')]).toEqual([8, 1, 7]);   // 7 invoices and a bill of supply, one invoice cancelled
    expect(inv.docs.map((d: any) => d.from).sort()).toEqual(['BOS/26-27/0001', 'INV/26-27/0001']);
    expect(j.doc_issue.doc_det.find((d: any) => d.doc_typ === 'Credit Note').docs[0].totnum).toBe(2);
  });
  it('excludes other months and cancelled documents from the sections', async () => {
    const j = JSON.stringify((await gstr1(db.web, owner, '2026-10')).json);
    expect(j).not.toContain('123456');
    const sep = (await gstr1(db.web, owner, '2026-09')).json as any;
    expect(sep.b2b[0].inv[0].val).toBe(145678);
  });
  it('reconciles with the ledger to the paisa', async () => {
    const r = await gstr1(db.web, owner, '2026-10');
    expect(r.reconciliation).toEqual({ ledgerTaxablePaise: '34000000', reportedTaxablePaise: '34000000', matches: true });
    expect(r.counts).toMatchObject({ b2b: 3, b2cl: 1, cdnr: 2 });
    expect(r.warnings.some((w) => /gt and cur_gt/.test(w))).toBe(true);
  });
  it('an empty month is an empty file, not an error', async () => {
    const r = await gstr1(db.web, owner, '2025-01');
    expect(r.json).toMatchObject({ gstin: gstin('27', 'AAPFU0939F'), fp: '012025' });
    expect(Object.keys(r.json)).toEqual(['gstin', 'fp', 'gt', 'cur_gt']);
    expect(r.reconciliation.matches).toBe(true);
  });
  it('validates the month and the role', async () => {
    expect(await fails(gstr1(db.web, owner, '2026-13'))).toBeInstanceOf(ValidationError);
    expect(periodBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01', fp: '122026' });
    await expect(gstr1(db.web, staff, '2026-10')).rejects.toBeInstanceOf(ForbiddenError);
    expect((await gstr1(db.web, accountant, '2026-10')).counts.b2b).toBe(3);
  });
});

describe('GST summary', () => {
  it('totals outward supplies by head, net of credit notes, with nil, exempt and reverse charge apart', async () => {
    const s = await gstSummary(db.web, owner, '2026-10');
    expect(rs(paise(0) + BigInt(s.outwardTaxable.taxable))).toBe(334300);
    expect(rs(BigInt(s.outwardTaxable.igst))).toBe(57904);
    expect(rs(BigInt(s.outwardTaxable.cgst))).toBe(750);
    expect(rs(BigInt(s.outwardTaxable.sgst))).toBe(750);
    expect(rs(BigInt(s.outwardReverseCharge.taxable))).toBe(4000);
    expect([rs(BigInt(s.nilRated)), rs(BigInt(s.exempt))]).toEqual([1000, 700]);
    expect(rs(BigInt(s.totalTax))).toBe(59404);
    expect(s.interStateToUnregistered.map((x) => [x.pos, rs(BigInt(x.taxable))]).sort()).toEqual([['29', 300300]]);
    expect(s.notes.join(' ')).toMatch(/not include|not included/);
  });
});
