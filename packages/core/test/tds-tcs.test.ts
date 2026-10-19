import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  convertEstimate, createBusiness, createParty, getDocument, issueDocument, previewTotals, recordPayment, resolveTenant, saveDraft,
  ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, buyer: string;
const line = (over = {}) => ({ name: 'Consulting', hsnSac: '998313', quantity: '1', rate: '10000.00', taxRateBp: 1800, kind: 'service' as const, ...over });
const inv = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'tax_invoice', partyId: buyer, docDate: '2026-10-18', lines: [line()], ...over });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Corporate Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('TCS and TDS on an invoice', () => {
  it('TCS is added to the total, TDS is not, and the rates come back when the draft is reopened', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ tcsBp: 100, tdsBp: 1000 }));          // TCS 1%, TDS 10%
    const d = (await getDocument(db.web, owner, id))!.document;
    expect(d).toMatchObject({ taxable_paise: '1000000', cgst_paise: '90000', sgst_paise: '90000', tcs_bp: 100, tds_bp: 1000 });
    expect(d.tcs_paise).toBe('11800');                                                          // 1% of 11,800 (taxable plus tax)
    expect(d.grand_total_paise).toBe('1191800');                                                // 11,918: TDS is not part of the total
    expect(d.tds_paise).toBe('100000');                                                         // 10% of the taxable 10,000
  });

  it('previews the net the customer pays', async () => {
    const p = await previewTotals(db.web, owner, inv({ tcsBp: 100, tdsBp: 1000 }));
    expect([p.tcs, p.tds, p.grandTotal, p.netReceivable]).toEqual(['11800', '100000', '1191800', '1091800']);
    const none = await previewTotals(db.web, owner, inv());
    expect([none.tcs, none.tds, none.netReceivable]).toEqual(['0', '0', none.grandTotal]);
  });

  it('editing a draft can change or clear the rates', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ tdsBp: 200 }));
    await saveDraft(db.web, owner, inv({ tcsBp: 0, tdsBp: 0 }), id);
    expect((await getDocument(db.web, owner, id))!.document).toMatchObject({ tcs_bp: 0, tds_bp: 0, tds_paise: '0', tcs_paise: '0' });
  });

  it('is paid in full once the customer pays the net and the TDS is recorded', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ tdsBp: 1000 }));
    await issueDocument(db.web, owner, id);
    await recordPayment(db.web, owner, { documentId: id, amount: '10620.00', method: 'upi' });   // 11,800 less 1,000 TDS
    expect((await getDocument(db.web, owner, id))!.document.payment_status).toBe('part_paid');
    await recordPayment(db.web, owner, { documentId: id, amount: '1180.00', method: 'tds' });
    expect((await getDocument(db.web, owner, id))!.document).toMatchObject({ payment_status: 'paid', amount_settled_paise: '1180000' });
  });

  it('refuses rates that are not a percentage between 0 and 100 in whole hundredths', async () => {
    for (const bad of [{ tdsBp: 10001 }, { tcsBp: -1 }, { tcsBp: 1.5 }, { tdsBp: 12.34 }]) {
      expect(await fails(saveDraft(db.web, owner, inv(bad)))).toBeInstanceOf(ValidationError);
    }
  });

  it('carries over to the invoice when an estimate is converted', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ docType: 'estimate', tcsBp: 100, tdsBp: 1000 }));
    await issueDocument(db.web, owner, id);
    const out = await convertEstimate(db.web, owner, id);
    expect((await getDocument(db.web, owner, out.id))!.document).toMatchObject({ doc_type: 'tax_invoice', tcs_bp: 100, tds_bp: 1000, tcs_paise: '11800', tds_paise: '100000' });
  });
});
