import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateIrpPayload } from '@kora/adapters';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  buildIrpPayload, convertEstimate, createBusiness, createParty, getDocument, gstr1, issueDocument, previewTotals, resolveTenant, saveDraft, startNote,
  updateBusinessProfile, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

/**
 * Regression tests from the overnight GST and money audit (docs/gst-audit.md). Each block names the rule it holds the code to.
 * They were written first, failed on the code as it stood, and pass with the fix.
 */
let db: TestDb;
let owner: TenantSession;
let local: string, abroadUnreg: string, regKA: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const gstin = (state: string, pan: string) => { const b = `${state}${pan}1Z`; return b + gstinCheckChar(b); };
const mk = async (over: Partial<DocIn>) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, { docType: 'tax_invoice', ...over } as DocIn)).id)).document;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('audit@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: gstin('27', 'AAPFU0939F'), stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  await updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', address: { line1: '12 MG Road', city: 'Pune', pincode: '411001' }, phone: '9876543210' });
  local = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', currency: 'USD' });
  abroadUnreg = await createParty(db.web, owner, { kind: 'customer', name: 'Karnataka Walk-in', stateCode: '29' });
  regKA = await createParty(db.web, owner, {
    kind: 'customer', name: 'Reg KA', gstin: gstin('29', 'BBBCC1234D'), billingAddress: { line1: '5 Brigade Road', city: 'Bengaluru', pincode: '560001' },
  });
}, 60_000);
afterAll(async () => { await db?.drop(); });

const goods = (rate: string, bp: number, over: Record<string, unknown> = {}) =>
  ({ name: 'Widget', hsnSac: '847130', quantity: '1', rate, taxRateBp: bp, unit: 'NOS', kind: 'goods' as const, ...over });

describe('rate slabs follow the date of supply (Notification 9/2025-Central Tax (Rate), in force 22 September 2025)', () => {
  it('refuses 12% and 28% on an invoice dated after the reform, with a message that says why', async () => {
    const e = await fails(previewTotals(db.web, owner, { docType: 'tax_invoice', partyId: local, docDate: '2026-10-10', lines: [goods('100', 1200)] }));
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/22 September 2025/);
    expect(await fails(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: local, docDate: '2026-04-01', lines: [goods('100', 2800)] }))).toBeInstanceOf(ValidationError);
  });
  it('still accepts them on an invoice dated before it, and refuses 40% there', async () => {
    const p = await previewTotals(db.web, owner, { docType: 'tax_invoice', partyId: local, docDate: '2025-08-01', lines: [goods('100', 1200)] });
    expect(p.cgst).toBe('600');
    expect(await fails(previewTotals(db.web, owner, { docType: 'tax_invoice', partyId: local, docDate: '2025-08-01', lines: [goods('100', 4000)] }))).toBeInstanceOf(ValidationError);
  });
  it('lets a credit note raised now correct an invoice from before the reform at the rate it was issued at', async () => {
    const old = await mk({ partyId: local, docDate: '2025-08-01', lines: [goods('1000', 1200)] });
    const cn = await saveDraft(db.web, owner, {
      docType: 'credit_note', partyId: local, originalDocumentId: old.id as string, docDate: '2026-10-10', lines: [goods('100', 1200)],
    });
    expect((await getDocument(db.web, owner, cn.id))!.document).toMatchObject({ taxable_paise: '10000', cgst_paise: '600' });
  });
});

describe('GSTR-1 B2C large threshold (Notification 12/2024-Central Tax: Rs 1 lakh from 1 August 2024, Rs 2.5 lakh before)', () => {
  const b2cl = async (period: string) => ((await gstr1(db.web, owner, period)).json as any).b2cl as any[] | undefined;
  const sections = async (period: string) => {
    const j = (await gstr1(db.web, owner, period)).json as any;
    return { large: (j.b2cl ?? []).flatMap((x: any) => x.inv.map((i: any) => i.val)), small: (j.b2cs ?? []).reduce((n: number, x: any) => n + x.txval, 0) };
  };
  it('from August 2024 an inter-state invoice to an unregistered buyer is large only if its value is more than Rs 1 lakh', async () => {
    await mk({ partyId: abroadUnreg, docDate: '2026-10-05', lines: [goods('95238', 500)] });     // 95,238 + 5% = 99,999.90, rounds to exactly 1,00,000
    await mk({ partyId: abroadUnreg, docDate: '2026-10-06', lines: [goods('95239', 500)] });     // 1,00,000.95, rounds to 1,00,001
    await mk({ partyId: abroadUnreg, docDate: '2026-10-07', lines: [goods('120000', 1800)] });   // 1,41,600
    const s = await sections('2026-10');
    expect(s.large.sort((a: number, b: number) => a - b)).toEqual([100001, 141600]);
    expect(s.small).toBe(95238);
  });
  it('before August 2024 the limit was Rs 2.5 lakh', async () => {
    await mk({ partyId: abroadUnreg, docDate: '2024-07-15', lines: [goods('120000', 1800)] });   // 1,41,600: not large in July 2024
    await mk({ partyId: abroadUnreg, docDate: '2024-07-16', lines: [goods('300000', 1800)] });   // 3,54,000: large
    const s = await sections('2024-07');
    expect(s.large).toEqual([354000]);
    expect(s.small).toBe(120000);
    await mk({ partyId: abroadUnreg, docDate: '2024-08-02', lines: [goods('120000', 1800)] });
    expect((await sections('2024-08')).large).toEqual([141600]);
    expect(await b2cl('2024-06')).toBeUndefined();
  });
});

describe('a quote in another currency becomes a rupee invoice without losing paise', () => {
  it('1,000 units at USD 0.01 and 83.25 is Rs 832.50 on the invoice, not Rs 830.00', async () => {
    const q = await mk({
      docType: 'estimate', partyId: local, currency: 'USD', exchangeRate: '83.25', docDate: '2026-10-10',
      lines: [goods('0.01', 1800, { quantity: '1000' })],
    });
    expect(q.grand_total_paise).toBe('1180');                                       // USD 11.80: 10.00 + 18%
    const made = await convertEstimate(db.web, owner, q.id as string);
    const inv = (await getDocument(db.web, owner, made.id))!;
    expect(inv.document).toMatchObject({ currency: 'INR', taxable_paise: '83250' });
    expect(inv.document.cgst_paise).toBe('7493');                                   // 9% of 832.50 = 74.925, rounds up
  });
  it('a rate that converts exactly is left alone, with no invented discount', async () => {
    const q = await mk({ docType: 'estimate', partyId: local, currency: 'USD', exchangeRate: '80', docDate: '2026-10-10', lines: [goods('10.00', 1800, { quantity: '3' })] });
    const inv = (await getDocument(db.web, owner, (await convertEstimate(db.web, owner, q.id as string)).id))!;
    expect(inv.lines[0]).toMatchObject({ rate_paise: '80000', discount_paise: '0', taxable_paise: '240000' });
  });
});

describe('a credit note copied from a tax-inclusive line takes back exactly what was invoiced', () => {
  it('3 x Rs 118.00 with Rs 11.80 off, GST included, then credited in full', async () => {
    const inv = await mk({ partyId: local, docDate: '2026-10-10', lines: [goods('118.00', 1800, { quantity: '3', discount: '11.80', taxInclusive: true })] });
    expect(inv).toMatchObject({ taxable_paise: '29000', cgst_paise: '2610', sgst_paise: '2610' });
    const cn = await startNote(db.web, owner, inv.id as string, 'credit_note');
    const note = (await getDocument(db.web, owner, cn.id))!.document;
    expect(note).toMatchObject({ taxable_paise: '29000', cgst_paise: '2610', sgst_paise: '2610' });
  });
  it('a half return takes back half the discount', async () => {
    const inv = await mk({ partyId: local, docDate: '2026-10-10', lines: [goods('118.00', 1800, { quantity: '4', discount: '23.60', taxInclusive: true })] });
    const cn = await startNote(db.web, owner, inv.id as string, 'credit_note', { lines: [{ position: 1, quantity: '2' }] });
    const note = (await getDocument(db.web, owner, cn.id))!.document;
    // 4 x 118 less 23.60 = 448.40 including GST, so 2 of them are 224.20: taxable 190.00, tax 34.20
    expect(note).toMatchObject({ taxable_paise: '19000', cgst_paise: '1710' });
  });
});

describe('an e-invoice carries a manual adjustment, because the portal checks the total', () => {
  for (const [adj, label] of [['-5', 'a deduction'], ['12.50', 'an addition']] as const) {
    it(`builds and passes the portal's rules with ${label}`, async () => {
      const d = await mk({ partyId: regKA, docDate: '2026-10-10', roundTotal: false, adjustment: adj, adjustmentLabel: 'Goodwill', lines: [goods('1000', 1800, { quantity: '2' })] });
      const full = (await getDocument(db.web, owner, d.id as string))!;
      const p = buildIrpPayload({ doc: full.document, lines: full.lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot }) as any;
      expect(validateIrpPayload(p)).toEqual([]);
      const v = p.ValDtls;
      const sum = v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.CesVal + v.OthChrg - v.Discount + v.RndOffAmt;
      expect(Math.round(sum * 100)).toBe(Math.round(v.TotInvVal * 100));
      expect(v.TotInvVal).toBe(Number(full.document.grand_total_paise) / 100);
    });
  }
});

describe('a credit or debit note belongs to the invoice it corrects (CGST Act section 34)', () => {
  it('goes to the same customer, and is not dated before the invoice', async () => {
    const inv = await mk({ partyId: local, docDate: '2026-10-10', lines: [goods('1000', 1800)] });
    const note = (over: Partial<DocIn>) => saveDraft(db.web, owner, { docType: 'credit_note', originalDocumentId: inv.id as string, lines: [goods('100', 1800)], ...over } as DocIn);
    const other = await fails(note({ partyId: regKA, docDate: '2026-10-11' }));
    expect(other).toBeInstanceOf(ValidationError);
    expect(other.message).toMatch(/same customer/);
    const early = await fails(note({ partyId: local, docDate: '2026-10-09' }));
    expect(early).toBeInstanceOf(ValidationError);
    expect(early.message).toMatch(/before the invoice/);
    await expect(note({ partyId: local, docDate: '2026-10-10' })).resolves.toBeTruthy();       // the same day is fine
    await expect(saveDraft(db.web, owner, { docType: 'debit_note', partyId: local, originalDocumentId: inv.id as string, docDate: '2026-11-01', lines: [goods('50', 1800)] })).resolves.toBeTruthy();
  });
});

describe('the late fee GST rate must be a real slab', () => {
  it('refuses 10%, 12% and above 40%, accepts 18% and 0%', async () => {
    const { saveLateFeeConfig } = await import('../src/index.js');
    for (const bp of [1000, 1200, 2800, 4100]) expect(await fails(saveLateFeeConfig(db.web, owner, { enabled: true, gstRateBp: bp }))).toBeInstanceOf(ValidationError);
    expect(await saveLateFeeConfig(db.web, owner, { enabled: true, gstRateBp: 1800 })).toMatchObject({ gstRateBp: 1800 });
    expect(await saveLateFeeConfig(db.web, owner, { enabled: true, gstRateBp: 0 })).toMatchObject({ gstRateBp: 0 });
  });
});

describe('an explicit place of supply is checked the same way as a derived one', () => {
  const pos = (placeOfSupply: string, docType: DocIn['docType'] = 'tax_invoice', extra: Partial<DocIn> = {}) =>
    previewTotals(db.web, owner, { docType, partyId: local, docDate: '2026-10-10', placeOfSupply, lines: [goods('100', 1800)], ...extra });
  it('refuses a code that is not a state or territory, and 96 (other country) on a tax invoice, as exports are not supported yet', async () => {
    for (const bad of ['00', '25', '28', '99', 'XX', '1', '97x', 'constructor', '__proto__']) expect(await fails(pos(bad))).toBeInstanceOf(ValidationError);
    expect((await fails(pos('96'))).message).toMatch(/Exports are not supported/);
  });
  it('accepts every real state and territory code, and 96 on a quote (which is not a tax document)', async () => {
    for (const ok of ['29', '07', '38', '26', '97']) expect((await pos(ok)).placeOfSupply).toBe(ok);
    expect((await pos('96', 'estimate', { currency: 'USD', exchangeRate: '83' })).placeOfSupply).toBe('96');
    expect((await fails(pos('96', 'estimate'))).message).toMatch(/Exports are not supported/);
  });
});
