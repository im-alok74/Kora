import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, duplicateDocument, getDocument, issueDocument, previewTotals, resolveTenant, saveDraft, type DocIn, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let buyer: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
// 1000.50 plus 18% = 1180.60, so the total is rounded up by 40 paise unless rounding is off
const inv = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'tax_invoice', partyId: buyer, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '1000.50', taxRateBp: 1800, kind: 'service' }], ...over });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('adjustment and rounding', () => {
  it('rounds to the rupee by default and keeps the paise when rounding is off', async () => {
    expect((await previewTotals(db.web, owner, inv())).grandTotal).toBe('118100');
    const off = await previewTotals(db.web, owner, inv({ roundTotal: false }));
    expect(off.grandTotal).toBe('118060');
    expect(off.roundOff).toBe('0');
  });

  it('adds an untaxed adjustment before rounding, as its own line', async () => {
    const t = await previewTotals(db.web, owner, inv({ adjustment: '-5', roundTotal: false }));
    expect(t.adjustment).toBe('-500');
    expect(t.grandTotal).toBe('117560');
    expect(t.cgst).toBe('9005');                              // tax is worked out on the lines only
    const { id } = await saveDraft(db.web, owner, inv({ adjustment: '+12.50', adjustmentLabel: 'Packing' }));
    await issueDocument(db.web, owner, id);
    const d = (await getDocument(db.web, owner, id))!.document;
    expect(d).toMatchObject({ adjustment_paise: '1250', adjustment_label: 'Packing', grand_total_paise: '119300' });
    const copy = await duplicateDocument(db.web, owner, id);
    expect((await getDocument(db.web, owner, copy.id))!.document).toMatchObject({ adjustment_paise: '1250', adjustment_label: 'Packing', round_total: true });
  });

  it('refuses an adjustment that is too big, unreadable, or bigger than the bill', async () => {
    expect((await fails(previewTotals(db.web, owner, inv({ adjustment: '10001' })))).message).toMatch(/at most Rs 10,000/);
    expect((await fails(previewTotals(db.web, owner, inv({ adjustment: 'five' })))).message).toMatch(/Adjustment/);
    expect((await fails(previewTotals(db.web, owner, inv({ adjustment: '-5000' })))).message).toMatch(/below zero/);
  });

  it('keeps the document check satisfied when saved with rounding off and an adjustment', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ adjustment: '-0.60', roundTotal: false }));
    expect((await getDocument(db.web, owner, id))!.document).toMatchObject({ grand_total_paise: '118000', round_total: false });
  });
});
