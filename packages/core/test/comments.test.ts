import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addComment, addMember, createBusiness, createParty, listComments, removeComment, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession, other: TenantSession, docId: string;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, a, x] = [await mk('owner@n.test'), await mk('staff@n.test'), await mk('ca@n.test'), await mk('x@n.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Notes Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, a, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  const c = await createParty(db.web, owner, { kind: 'customer', name: 'Buyer', stateCode: '27' });
  docId = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: c, lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }] })).id;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('team notes on a document', () => {
  it('are kept in order with who wrote them', async () => {
    await addComment(db.web, owner, docId, 'Check the PO number.');
    await addComment(db.web, staff, docId, '  Customer promised Friday.  ');
    const list = await listComments(db.web, owner, docId);
    expect(list.map((c) => c.body)).toEqual(['Check the PO number.', 'Customer promised Friday.']);
    expect(list.map((c) => c.author)).toEqual(['owner@n.test', 'staff@n.test']);
    expect(list.map((c) => c.mine)).toEqual([true, false]);
  });
  it('can be read by an accountant but not written, and not seen by another business', async () => {
    expect(await listComments(db.web, accountant, docId)).toHaveLength(2);
    await expect(addComment(db.web, accountant, docId, 'hello')).rejects.toThrow();
    expect(await listComments(db.web, other, docId)).toEqual([]);
    await expect(addComment(db.web, other, docId, 'hello')).rejects.toThrow(/Document not found/);
  });
  it('refuse an empty or very long note', async () => {
    await expect(addComment(db.web, owner, docId, '   ')).rejects.toThrow();
    await expect(addComment(db.web, owner, docId, 'x'.repeat(1001))).rejects.toThrow();
  });
  it('can be removed by the writer or an owner, and by no one else', async () => {
    const [mine, theirs] = await listComments(db.web, staff, docId);
    await expect(removeComment(db.web, staff, docId, mine!.id)).rejects.toThrow(/Only the person who wrote/);
    await removeComment(db.web, staff, docId, theirs!.id);                          // staff removes their own
    await removeComment(db.web, owner, docId, mine!.id);                            // an owner removes anyone's
    expect(await listComments(db.web, owner, docId)).toEqual([]);
    await expect(removeComment(db.web, owner, docId, mine!.id)).rejects.toThrow(/not found/);
  });
  it('are removed with the document', async () => {
    await addComment(db.web, owner, docId, 'gone soon');
    await db.owner`delete from document where id = ${docId}`;
    expect((await db.owner`select count(*)::int as n from document_comment where document_id = ${docId}`)[0]!.n).toBe(0);
  });
});
