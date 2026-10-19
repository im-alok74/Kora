import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { ConflictError, createBusiness, createParty, getDocument, isConflictError, issueDocument, resolveTenant, saveDraft, ValidationError, type DocIn, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let cust: string;
const inv = (rate = '1000'): DocIn => ({ docType: 'tax_invoice', partyId: cust, docDate: '2026-10-18', lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate, taxRateBp: 1800 }] });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const count = async (ref: string) => (await db.owner`select count(*)::int as n from document where client_ref = ${ref}`)[0]!.n as number;
const total = async (id: string) => (await getDocument(db.web, owner, id))!.document.grand_total_paise;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('syncing drafts from a device', () => {
  it('a retried create with the same reference lands on the same document', async () => {
    const a = await saveDraft(db.web, owner, inv('1000'), null, { clientRef: 'device-a-0001' });
    const b = await saveDraft(db.web, owner, inv('2000'), null, { clientRef: 'device-a-0001' });
    expect(b.id).toBe(a.id);
    expect(await count('device-a-0001')).toBe(1);
    expect(await total(a.id)).toBe('236000');   // the later content wins
    expect(b.rev).toBeGreaterThan(a.rev);
  });
  it('ten simultaneous syncs of one draft make exactly one document', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => saveDraft(db.web, owner, inv(), null, { clientRef: 'device-b-race1' })));
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(await count('device-b-race1')).toBe(1);
  });
  it('revision numbers go up with every change and a matching base revision is accepted', async () => {
    const a = await saveDraft(db.web, owner, inv(), null, { clientRef: 'device-c-rev01' });
    const b = await saveDraft(db.web, owner, inv('1500'), a.id, { baseRev: a.rev });
    expect(b.rev).toBeGreaterThan(a.rev);
    const c = await saveDraft(db.web, owner, inv('1600'), a.id, { baseRev: b.rev });
    expect(c.rev).toBeGreaterThan(b.rev);
  });
  it('a stale base revision is a conflict that names the current revision, and changes nothing', async () => {
    const a = await saveDraft(db.web, owner, inv('100'), null, { clientRef: 'device-d-conf1' });
    await saveDraft(db.web, owner, inv('777'), a.id, { baseRev: a.rev });                          // the other device
    const e = await fails(saveDraft(db.web, owner, inv('555'), a.id, { baseRev: a.rev }));        // this device, on the old revision
    expect(isConflictError(e)).toBe(true);
    expect(e).toBeInstanceOf(ConflictError);
    expect((e as ConflictError).documentId).toBe(a.id);
    expect(await total(a.id)).toBe('91700');   // 777 plus 18% is 916.86, rounded to the rupee
  });
  it('choosing "keep mine" is a save against the current revision', async () => {
    const a = await saveDraft(db.web, owner, inv('100'), null, { clientRef: 'device-e-keep1' });
    await saveDraft(db.web, owner, inv('777'), a.id);
    const e = (await fails(saveDraft(db.web, owner, inv('555'), a.id, { baseRev: a.rev }))) as ConflictError;
    const mine = await saveDraft(db.web, owner, inv('555'), a.id, { baseRev: e.serverRev });
    expect(mine.rev).toBeGreaterThan(e.serverRev);
    expect(await total(a.id)).toBe('65500');
  });
  it('a retry after the draft was issued elsewhere reports that, and changes nothing', async () => {
    const a = await saveDraft(db.web, owner, inv(), null, { clientRef: 'device-f-issue' });
    const issued = (await issueDocument(db.web, owner, a.id)).document;
    const r = await saveDraft(db.web, owner, inv('5'), null, { clientRef: 'device-f-issue' });
    expect(r).toMatchObject({ id: a.id, alreadyIssued: true });
    expect(await total(a.id)).toBe(issued.grand_total_paise);
    expect((await fails(saveDraft(db.web, owner, inv('5'), a.id))).message).toMatch(/Only a draft can be edited/);
  });
  it('rejects a malformed client reference', async () => {
    expect(await fails(saveDraft(db.web, owner, inv(), null, { clientRef: 'x' }))).toBeInstanceOf(ValidationError);
    expect(await fails(saveDraft(db.web, owner, inv(), null, { clientRef: "a'; drop table document;--" }))).toBeInstanceOf(ValidationError);
  });
  it('the same reference in two businesses does not collide', async () => {
    const [u2] = await db.owner`insert into app_user (email) values ('o2@example.test') returning id`;
    const bid2 = await createBusiness(db.web, u2!.id as string, { legalName: 'Other Biz', gstin: '29BBBCC1234D1Z4', stateCode: '29', registrationType: 'regular' });
    const t2 = await resolveTenant(db.web, u2!.id as string, bid2);
    const a = await saveDraft(db.web, owner, inv(), null, { clientRef: 'shared-ref-001' });
    const b = await saveDraft(db.web, t2, { docType: 'estimate', docDate: '2026-10-18', lines: [{ name: 'x', quantity: '1', rate: '1', taxRateBp: 0 }] }, null, { clientRef: 'shared-ref-001' });
    expect(b.id).not.toBe(a.id);
  });
});
