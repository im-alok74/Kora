import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, duplicateDocument, getDocument, issueDocument, resolveTenant, saveDraft, startNote, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, customer: string;
const line = (rate = '1000') => ({ name: 'Consulting', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('ref@e.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Ref Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  customer = await createParty(db.web, owner, { kind: 'customer', name: 'Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('reference, subject and payment terms', () => {
  it('keeps them on the draft, prints them from the document, and freezes them when issued', async () => {
    const r = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-10-20', reference: 'PO-7781', subject: 'Phase 2', paymentTerms: 'net30', lines: [line()] });
    const d = (await getDocument(db.web, owner, r.id))!.document;
    expect(d).toMatchObject({ reference: 'PO-7781', subject: 'Phase 2', payment_terms: 'net30' });
    expect(String(d.due_date).slice(0, 10)).toBe('2026-11-19');            // the preset filled the due date
    await issueDocument(db.web, owner, r.id);
    await expect(db.owner`update document set reference = 'CHANGED' where id = ${r.id}`).rejects.toThrow(/immutable/);
  });
  it('lets an explicit due date win over the preset', async () => {
    const r = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-10-20', dueDate: '2026-12-01', paymentTerms: 'net15', lines: [line()] });
    expect(String((await getDocument(db.web, owner, r.id))!.document.due_date).slice(0, 10)).toBe('2026-12-01');
  });
  it('fills the due date for end of month, and leaves it empty when there are no terms', async () => {
    const a = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-02-10', paymentTerms: 'eom', lines: [line()] });
    expect(String((await getDocument(db.web, owner, a.id))!.document.due_date).slice(0, 10)).toBe('2026-02-28');
    const b = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()] });
    expect((await getDocument(db.web, owner, b.id))!.document.due_date).toBeNull();
  });
  it('refuses an unknown term and text that is too long', async () => {
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, paymentTerms: 'net99', lines: [line()] })).rejects.toThrow(/payment terms/i);
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, reference: 'x'.repeat(61), lines: [line()] })).rejects.toThrow();
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, subject: 'x'.repeat(201), lines: [line()] })).rejects.toThrow();
  });
});

describe('duplicating a document', () => {
  it('makes a new draft with the same customer, lines, notes and terms, and no number', async () => {
    const src = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-10-01', notes: 'Hello', terms: 'Pay fast', reference: 'PO-1', paymentTerms: 'net15', lines: [line('2500'), { ...line('300'), name: 'Travel', taxRateBp: 500 }] });
    await issueDocument(db.web, owner, src.id);
    const copy = await duplicateDocument(db.web, owner, src.id);
    expect(copy.id).not.toBe(src.id);
    const c = (await getDocument(db.web, owner, copy.id))!;
    expect(c.document).toMatchObject({ status: 'draft', number: null, party_id: customer, notes: 'Hello', terms: 'Pay fast', reference: 'PO-1', payment_terms: 'net15', doc_type: 'tax_invoice' });
    expect(c.lines.map((l) => [l.item_name, l.rate_paise, l.tax_rate_bp])).toEqual([['Consulting', '250000', 1800], ['Travel', '30000', 500]]);
    expect(c.document.grand_total_paise).toBe((await getDocument(db.web, owner, src.id))!.document.grand_total_paise);
  });
  it('does not copy a note, which answers one invoice, and says so', async () => {
    const inv = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()] });
    await issueDocument(db.web, owner, inv.id);
    const note = await startNote(db.web, owner, inv.id, 'credit_note');
    await expect(duplicateDocument(db.web, owner, note.id)).rejects.toThrow(/note answers one invoice/i);
  });
  it('cannot reach another business\'s document', async () => {
    const [x] = await db.owner`insert into app_user (email) values ('other@e.test') returning id`;
    const other = await resolveTenant(db.web, x!.id as string, await createBusiness(db.web, x!.id as string, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
    const mine = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()] });
    await expect(duplicateDocument(db.web, other, mine.id)).rejects.toThrow();
  });
});
