import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { withLinkedTenant, type Tx } from '@kora/db';
import {
  acceptClientLink, addClient, addFirmMember, addMember, createBusiness, createFirm, demoGstin, getClientLink, linkedClientSummary, listBusinessLinks, listClients,
  inTenant, linkedClientReconciliation, requestClientLink, resolveFirm, resolveTenant, revokeBusinessLink, revokeClientLink, assignClient, type FirmSession, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession;
let owner: TenantSession, staff: TenantSession;
let alpha: string, beta: string;
const g = (n: number) => demoGstin('27', String(2000 + n));

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, o, st] = [await mk('p@e.test'), await mk('q@e.test'), await mk('o@e.test'), await mk('st@e.test')] as [string, string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  await addFirmMember(db.web, p, f, q, 'preparer');
  [partner, prep] = [await resolveFirm(db.web, p, f), await resolveFirm(db.web, q, f)];
  const biz = await createBusiness(db.web, o, { legalName: 'Alpha Foods', gstin: null, stateCode: '27', registrationType: 'unregistered' });
  await addMember(db.web, o, biz, st, 'staff');
  [owner, staff] = [await resolveTenant(db.web, o, biz), await resolveTenant(db.web, st, biz)];
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: g(1) }] });
  await addClient(db.web, partner, { legalName: 'Beta Trading', registrations: [{ gstin: g(2) }] });
  const all = (await listClients(db.web, partner)).clients;
  [alpha, beta] = [all.find((c) => c.legalName === 'Alpha Foods')!.id, all.find((c) => c.legalName === 'Beta Trading')!.id];
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('client to business link', () => {
  let code: string;
  it('cannot read a business before it is linked', async () => {
    await expect(linkedClientSummary(db.web, partner, alpha)).rejects.toThrow(/not linked/);
    expect(await getClientLink(db.web, partner, alpha)).toEqual({ status: 'none' });
  });
  it('gives a one-time code and stores only its hash', async () => {
    ({ code } = await requestClientLink(db.web, partner, alpha));
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect((await getClientLink(db.web, partner, alpha)).status).toBe('pending');
    const rows = await db.owner`select code_hash from client_business_link`;
    expect(JSON.stringify(rows)).not.toContain(code.replace('-', ''));
  });
  it('is accepted only by the owner of the business, with the right code', async () => {
    await expect(acceptClientLink(db.web, staff, code)).rejects.toThrow(/Only the owner/);
    await expect(acceptClientLink(db.web, owner, 'WRONG-CODE')).rejects.toThrow(/not valid/);
    await acceptClientLink(db.web, owner, code.toLowerCase());
    expect((await getClientLink(db.web, partner, alpha)).status).toBe('active');
    await expect(acceptClientLink(db.web, owner, code)).rejects.toThrow(/not valid/); // single use
  });
  it('lets the firm read the dashboard without making its people members of the business', async () => {
    const d = await linkedClientSummary(db.web, partner, alpha);
    expect(d).toHaveProperty('today');
    const m = await db.owner`select user_id from member where business_id = ${owner.businessId}`;
    expect(m.map((r) => r.user_id as string).sort()).toEqual([owner.userId, staff.userId].sort());
  });
  it('hides the link from a preparer who is not assigned, and shows it once assigned', async () => {
    await expect(linkedClientSummary(db.web, prep, alpha)).rejects.toThrow(/not found/);
    await assignClient(db.web, partner, alpha, prep.userId);
    expect(await linkedClientSummary(db.web, prep, alpha)).toHaveProperty('today');
  });
  it('shows the owner who can read the business, and the owner can revoke', async () => {
    const links = await listBusinessLinks(db.web, owner);
    expect(links).toMatchObject([{ firmName: 'Sharma and Co', clientName: 'Alpha Foods', status: 'active' }]);
    await expect(listBusinessLinks(db.web, staff)).rejects.toThrow();
    await expect(revokeBusinessLink(db.web, staff, links[0]!.linkId)).rejects.toThrow();
    await revokeBusinessLink(db.web, owner, links[0]!.linkId);
    await expect(linkedClientSummary(db.web, partner, alpha)).rejects.toThrow(/not linked/);
    await expect(linkedClientSummary(db.web, prep, alpha)).rejects.toThrow(/not linked/);
  });
  it('lets the firm revoke too, and an expired code is refused', async () => {
    const r = await requestClientLink(db.web, partner, alpha);
    await acceptClientLink(db.web, owner, r.code);
    expect(await linkedClientSummary(db.web, partner, alpha)).toHaveProperty('today');
    await revokeClientLink(db.web, partner, alpha);
    await expect(linkedClientSummary(db.web, partner, alpha)).rejects.toThrow(/not linked/);
    const e = await requestClientLink(db.web, partner, beta);
    await db.owner`update client_business_link set expires_at = now() - interval '1 minute' where client_id = ${beta}`;
    await expect(acceptClientLink(db.web, owner, e.code)).rejects.toThrow(/not valid or has expired/);
  });
  it('is read only in the database, and a revoked link is refused by the database itself', async () => {
    const r = await requestClientLink(db.web, partner, beta);
    await acceptClientLink(db.web, owner, r.code);
    const biz = owner.businessId;
    const via = { ...owner, userId: partner.userId, role: 'accountant' as const, viaFirm: partner.firmId };
    expect(() => inTenant(db.web, via, 'document.write', async () => 1)).toThrow(/cannot do this/);
    const direct = (fn: (tx: Tx) => Promise<unknown>) => withLinkedTenant(db.web, { businessId: biz, userId: partner.userId, firmId: partner.firmId }, fn);
    expect(await direct((tx) => tx`select id from business where id = ${biz}`)).toHaveLength(1);
    await expect(direct((tx) => tx`update business set trade_name = 'x' where id = ${biz}`)).rejects.toThrow(/read-only/);
    await db.owner`update client_business_link set status = 'revoked', code_hash = null where client_id = ${beta}`;
    expect(await direct((tx) => tx`select id from business where id = ${biz}`)).toHaveLength(0);
  });
  it('will not link a client that is already linked', async () => {
    const r = await requestClientLink(db.web, partner, alpha);
    await acceptClientLink(db.web, owner, r.code);
    await expect(requestClientLink(db.web, partner, alpha)).rejects.toThrow(/already linked/);
  });
});

describe("reading the linked client's books against GSTR-2B", () => {
  it('counts what is in the statement and not in the books, read-only, for a linked client only', async () => {
    expect(await linkedClientReconciliation(db.web, partner, beta, '2026-09')).toBeNull();   // not linked
    await db.owner`insert into gstr2b_entry (business_id, period, supplier_gstin, invoice_number, taxable_paise, cgst_paise)
                   values (${owner.businessId}, '2026-09', ${g(40)}, 'S-1', 100000, 9000), (${owner.businessId}, '2026-09', ${g(41)}, 'S-2', 50000, 4500)`;
    expect(await linkedClientReconciliation(db.web, partner, alpha, '2026-09')).toEqual({ period: '2026-09', loaded: 2, matched: 0, mismatched: 0, onlyIn2b: 2, onlyInBooks: 0 });
    const [n] = await db.owner`select count(*)::int as n from gstr2b_entry where business_id = ${owner.businessId} and bill_id is not null`;
    expect(n!.n).toBe(0);                                                                      // nothing was matched or written by looking
    await expect(linkedClientReconciliation(db.web, partner, alpha, 'soon')).rejects.toThrow(/Period/);
  });
  it('stops the moment the link is revoked', async () => {
    await revokeClientLink(db.web, partner, alpha);
    expect(await linkedClientReconciliation(db.web, partner, alpha, '2026-09')).toBeNull();
  });
});
