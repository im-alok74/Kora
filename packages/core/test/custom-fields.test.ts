import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  archiveCustomField, createBusiness, createCustomField, createParty, duplicateDocument, getDocument, getPartyCustom, issueDocument, listCustomFields,
  resolveTenant, saveDraft, setPartyCustom, updateCustomField, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let buyer: string;
let project: string, due: string, size: string, qty: string, gate: string;

const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const line = () => ({ name: 'Work', hsnSac: '998313', quantity: '1', rate: '1000.00', taxRateBp: 1800, kind: 'service' as const });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', phone: '9876543210' });
  project = (await createCustomField(db.web, owner, { entity: 'document', label: 'Project code', kind: 'text' })).id;
  due = (await createCustomField(db.web, owner, { entity: 'document', label: 'Site visit', kind: 'date', showOnPdf: false })).id;
  size = (await createCustomField(db.web, owner, { entity: 'document', label: 'Priority', kind: 'dropdown', options: ['Low', 'High'] })).id;
  qty = (await createCustomField(db.web, owner, { entity: 'document', label: 'Crates', kind: 'number' })).id;
  gate = (await createCustomField(db.web, owner, { entity: 'customer', label: 'Vendor code', kind: 'text' })).id;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('custom fields', () => {
  it('lists fields by entity and refuses a duplicate name or a bad definition', async () => {
    expect((await listCustomFields(db.web, owner, 'document')).map((f) => f.label)).toEqual(['Project code', 'Site visit', 'Priority', 'Crates']);
    expect((await listCustomFields(db.web, owner, 'customer')).map((f) => f.label)).toEqual(['Vendor code']);
    expect((await fails(createCustomField(db.web, owner, { entity: 'document', label: 'project CODE', kind: 'text' }))).message).toMatch(/already have/);
    expect((await fails(createCustomField(db.web, owner, { entity: 'document', label: 'Pick', kind: 'dropdown', options: ['Only'] }))).message).toMatch(/2 and 20/);
    expect((await fails(createCustomField(db.web, owner, { entity: 'document', label: '', kind: 'text' }))).message).toMatch(/name/);
  });

  it('keeps the answers on a draft with their labels, and checks each kind', async () => {
    const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()], custom: { [project]: ' P-9 ', [size]: 'High', [qty]: '12.5', [due]: '' } });
    const d = (await getDocument(db.web, owner, id))!.document;
    expect(d.custom_values).toEqual([
      { id: project, label: 'Project code', value: 'P-9', pdf: true }, { id: size, label: 'Priority', value: 'High', pdf: true }, { id: qty, label: 'Crates', value: '12.5', pdf: true },
    ]);
    for (const [bad, msg] of [[{ [qty]: 'many' }, /must be a number/], [{ [due]: '31/12/2026' }, /YYYY-MM-DD/], [{ [size]: 'Urgent' }, /listed options/], [{ nope: 'x' }, /no longer there/]] as const) {
      expect((await fails(saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()], custom: bad as Record<string, string> }))).message).toMatch(msg);
    }
  });

  it('renaming or archiving a field never changes an issued document, and a copy drops archived fields', async () => {
    const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()], custom: { [project]: 'P-1', [size]: 'Low' } });
    await issueDocument(db.web, owner, id);
    await updateCustomField(db.web, owner, project, { label: 'Job number', showOnPdf: true });
    await archiveCustomField(db.web, owner, size);
    const issued = (await getDocument(db.web, owner, id))!.document;
    expect((issued.custom_values as { label: string }[]).map((v) => v.label)).toEqual(['Project code', 'Priority']);
    const copy = await duplicateDocument(db.web, owner, id);
    const c = (await getDocument(db.web, owner, copy.id))!.document;
    expect(c.custom_values).toEqual([{ id: project, label: 'Job number', value: 'P-1', pdf: true }]);
  });

  it('keeps answers on a customer, and they are copied onto the document when it is issued', async () => {
    const set = await setPartyCustom(db.web, owner, buyer, { [gate]: 'V-204' });
    expect(set.custom).toEqual([{ id: gate, label: 'Vendor code', value: 'V-204', pdf: true }]);
    expect(await getPartyCustom(db.web, owner, buyer)).toHaveLength(1);
    const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()] });
    await issueDocument(db.web, owner, id);
    await setPartyCustom(db.web, owner, buyer, { [gate]: 'V-999' });
    const snap = (await getDocument(db.web, owner, id))!.document.recipient_snapshot as { custom_values: { value: string }[] };
    expect(snap.custom_values[0]!.value).toBe('V-204');
    expect((await fails(setPartyCustom(db.web, owner, buyer, { [project]: 'x' }))).message).toMatch(/no longer there/);
  });

  it('allows at most ten live fields for one kind of record', async () => {
    for (let i = 0; i < 6; i++) await createCustomField(db.web, owner, { entity: 'customer', label: `Extra ${i}`, kind: 'text' });
    for (let i = 6; i < 9; i++) await createCustomField(db.web, owner, { entity: 'customer', label: `Extra ${i}`, kind: 'text' });
    expect((await fails(createCustomField(db.web, owner, { entity: 'customer', label: 'One too many', kind: 'text' }))).message).toMatch(/up to 10/);
  });
});
