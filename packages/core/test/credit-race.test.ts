import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, getDocument, issueDocument, resolveTenant, saveDraft, startNote, type TenantSession } from '../src/index.js';

// Audit finding C-1: the headroom check read the credited total without locking the original invoice, so two credit
// notes issued at the same moment could both pass it and credit one invoice twice.
let db: TestDb;
let t: TenantSession;
let party: string;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('race@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  t = await resolveTenant(db.web, u!.id as string, bid);
  party = await createParty(db.web, t, { kind: 'customer', name: 'Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

const invoice = async () => (await issueDocument(db.web, t, (await saveDraft(db.web, t, {
  docType: 'tax_invoice', partyId: party, docDate: '2026-10-01', lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }],
})).id)).document;

describe('credit notes issued at the same moment', () => {
  it('cannot together take back more than the invoice', async () => {
    const inv = await invoice();
    const a = await startNote(db.web, t, inv.id as string, 'credit_note');
    const b = await startNote(db.web, t, inv.id as string, 'credit_note');
    const out = await Promise.allSettled([issueDocument(db.web, t, a.id), issueDocument(db.web, t, b.id)]);
    expect(out.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    const [row] = await db.owner`select coalesce(sum(taxable_paise), 0)::text as s from document where original_document_id = ${inv.id as string} and doc_type = 'credit_note' and status = 'issued'`;
    expect(BigInt(row!.s as string)).toBeLessThanOrEqual(BigInt((await getDocument(db.web, t, inv.id as string))!.document.taxable_paise as string));
  });
  it('two half credits and a third are decided in order, never beyond the whole', async () => {
    const inv = await invoice();
    const mk = (rate: string) => saveDraft(db.web, t, { docType: 'credit_note', partyId: party, originalDocumentId: inv.id as string, docDate: '2026-10-02',
      lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' }] });
    const [x, y, z] = [await mk('500'), await mk('500'), await mk('500')];
    const out = await Promise.allSettled([x, y, z].map((d) => issueDocument(db.web, t, d.id)));
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(2);
  });
});
