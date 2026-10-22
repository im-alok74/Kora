import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, getDocument, issueDocument, noteContext, resolveTenant, saveDraft, startNote, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let invoice: string;

const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  const buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', phone: '9876543210' });
  const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [
    { name: 'Chair', hsnSac: '9401', quantity: '10', rate: '1000.00', discount: '500.00', taxRateBp: 1800, kind: 'goods' },
    { name: 'Table', hsnSac: '9403', quantity: '2', rate: '5000.00', taxRateBp: 1800, kind: 'goods' },
  ] });
  invoice = d.id;
  await issueDocument(db.web, owner, invoice);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('guided credit and debit notes', () => {
  it('credits only the picked lines at the quantity given, with the discount in proportion, and keeps the reason', async () => {
    const r = await startNote(db.web, owner, invoice, 'credit_note', { reason: 'goods_returned', detail: '3 chairs broken', lines: [{ position: 1, quantity: '3' }] });
    const n = (await getDocument(db.web, owner, r.id))!;
    expect(n.document).toMatchObject({ doc_type: 'credit_note', status: 'draft', note_reason: 'goods_returned', note_reason_detail: '3 chairs broken', original_document_id: invoice });
    expect(n.lines).toHaveLength(1);
    expect(Number(n.lines[0]!.quantity)).toBe(3);
    // 3 of 10 chairs: 3 x 1000 less 3/10 of the 500 discount
    expect(n.lines[0]!.discount_paise).toBe('15000');
    expect(n.document.taxable_paise).toBe('285000');
  });

  it('refuses to credit more than was invoiced, or at a higher rate', async () => {
    expect((await fails(startNote(db.web, owner, invoice, 'credit_note', { reason: 'goods_returned', lines: [{ position: 1, quantity: '11' }] }))).message).toMatch(/cannot credit 11/);
    expect((await fails(startNote(db.web, owner, invoice, 'credit_note', { reason: 'price_correction', lines: [{ position: 2, rate: '5001' }] }))).message).toMatch(/debit note/);
    expect((await fails(startNote(db.web, owner, invoice, 'credit_note', { reason: 'additional_charge', lines: [{ position: 1 }] }))).message).toMatch(/listed reasons/);
    expect((await fails(startNote(db.web, owner, invoice, 'credit_note', { reason: 'other', lines: [{ position: 9 }] }))).message).toMatch(/not on the invoice/);
    expect((await fails(startNote(db.web, owner, invoice, 'credit_note', { reason: 'other', lines: [] }))).message).toMatch(/at least one/);
  });

  it('a price cut keeps the quantity and lowers the rate', async () => {
    const r = await startNote(db.web, owner, invoice, 'credit_note', { reason: 'post_sale_discount', lines: [{ position: 2, rate: '500.00' }] });
    expect((await getDocument(db.web, owner, r.id))!.document.taxable_paise).toBe('100000');
  });

  it('a debit note may charge a higher rate', async () => {
    const r = await startNote(db.web, owner, invoice, 'debit_note', { reason: 'price_correction', lines: [{ position: 2, rate: '5200.00' }] });
    await issueDocument(db.web, owner, r.id);
    expect((await getDocument(db.web, owner, r.id))!.document.number).toMatch(/^DN\//);
  });

  it('still copies every line when no lines are picked, and tells the screen what is already credited', async () => {
    const all = await startNote(db.web, owner, invoice, 'credit_note');
    expect((await getDocument(db.web, owner, all.id))!.lines).toHaveLength(2);
    const small = await startNote(db.web, owner, invoice, 'credit_note', { reason: 'goods_returned', lines: [{ position: 1, quantity: '1' }] });
    await issueDocument(db.web, owner, small.id);
    const ctx = await noteContext(db.web, owner, invoice);
    expect(ctx.creditedTaxablePaise).toBe('95000');
    expect(ctx.lines.map((l) => l.name)).toEqual(['Chair', 'Table']);
    expect(ctx.reasons.debit_note).toContain('additional_charge');
    expect(ctx.notes.length).toBeGreaterThanOrEqual(4);
  });
});
