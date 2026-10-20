import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, duplicateDocument, getBusiness, getDocument, issueDocument, previewDocumentData, resolveTenant, saveDraft, updateBusinessProfile, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, customer: string;
const line = (rate = '1000') => ({ name: 'Consulting', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('p1@e.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Phase One', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  customer = await createParty(db.web, owner, { kind: 'customer', name: 'Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('extra details and salesperson', () => {
  it('keeps trimmed pairs, drops empty rows, and carries them into a duplicate', async () => {
    const r = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, salesperson: ' Asha ', lines: [line()],
      extra: [{ label: ' Vehicle no. ', value: 'MH12 AB 1234' }, { label: '', value: '' }, { label: 'Project', value: 'P-9' }] });
    const d = (await getDocument(db.web, owner, r.id))!.document;
    expect(d.extra).toEqual([{ label: 'Vehicle no.', value: 'MH12 AB 1234' }, { label: 'Project', value: 'P-9' }]);
    expect(d.salesperson).toBe('Asha');
    const copy = await duplicateDocument(db.web, owner, r.id);
    expect((await getDocument(db.web, owner, copy.id))!.document).toMatchObject({ extra: d.extra, salesperson: 'Asha' });
  });
  it('refuses a half-filled pair, more than five, and long text', async () => {
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()], extra: [{ label: 'Only a name', value: '' }] })).rejects.toThrow(/both a name and a value/);
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()], extra: six })).rejects.toThrow(/at most five/);
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()], extra: [{ label: 'x'.repeat(41), value: 'v' }] })).rejects.toThrow();
    await expect(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()], salesperson: 'x'.repeat(81) })).rejects.toThrow();
  });
  it('freezes with the document when it is issued', async () => {
    const r = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line()], extra: [{ label: 'A', value: 'B' }], salesperson: 'Ravi' });
    await issueDocument(db.web, owner, r.id);
    await expect(db.owner`update document set salesperson = 'Someone else' where id = ${r.id}`).rejects.toThrow(/immutable/);
    await expect(db.owner`update document set extra = '[]'::jsonb where id = ${r.id}`).rejects.toThrow(/immutable/);
  });
});

describe('default notes and terms', () => {
  it('are saved with the business profile, kept when the profile is saved without them, and cleared by an empty string', async () => {
    const b = await getBusiness(db.web, owner);
    const base = { legalName: b.legal_name as string, gstin: b.gstin as string, address: b.address as any, phone: null, email: null, upiVpa: null };
    await updateBusinessProfile(db.web, owner, { ...base, defaultNotes: 'Thank you.', defaultTerms: 'Pay in 30 days.' });
    expect(await getBusiness(db.web, owner)).toMatchObject({ default_notes: 'Thank you.', default_terms: 'Pay in 30 days.' });
    await updateBusinessProfile(db.web, owner, { ...base });                                            // not mentioned: kept
    expect(await getBusiness(db.web, owner)).toMatchObject({ default_notes: 'Thank you.', default_terms: 'Pay in 30 days.' });
    await updateBusinessProfile(db.web, owner, { ...base, defaultNotes: '' });                          // empty: cleared
    expect(await getBusiness(db.web, owner)).toMatchObject({ default_notes: null, default_terms: 'Pay in 30 days.' });
    await expect(updateBusinessProfile(db.web, owner, { ...base, defaultNotes: 'x'.repeat(2001) })).rejects.toThrow();
  });
});

describe('previewing an unsaved draft', () => {
  it('returns what the renderer needs and writes nothing', async () => {
    const before = await db.owner`select count(*)::int as n from document`;
    const p = await previewDocumentData(db.web, owner, { docType: 'tax_invoice', partyId: customer, docDate: '2026-10-20', paymentTerms: 'net30', reference: 'PO-1',
      extra: [{ label: 'Site', value: 'Pune' }], lines: [line('1000')] });
    expect(p.doc).toMatchObject({ status: 'draft', number: null, due_date: '2026-11-19', reference: 'PO-1', grand_total_paise: '118000', taxable_paise: '100000' });
    expect(p.doc.extra).toEqual([{ label: 'Site', value: 'Pune' }]);
    expect(p.lines[0]).toMatchObject({ item_name: 'Consulting', rate_paise: '100000', tax_rate_bp: 1800, line_total_paise: '118000' });
    expect(p.supplier).toMatchObject({ legal_name: 'Phase One' });
    expect(p.recipient).toMatchObject({ name: 'Buyer' });
    const after = await db.owner`select count(*)::int as n from document`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
  it('shows the same totals as saving would, and says what is wrong with a bad draft', async () => {
    const input = { docType: 'tax_invoice' as const, partyId: customer, lines: [{ ...line('500'), discount: '50' }] };
    const p = await previewDocumentData(db.web, owner, input);
    const saved = await saveDraft(db.web, owner, input);
    expect((await getDocument(db.web, owner, saved.id))!.document.grand_total_paise).toBe(p.doc.grand_total_paise);
    await expect(previewDocumentData(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [] })).rejects.toThrow(/at least one line/i);
  });
});
