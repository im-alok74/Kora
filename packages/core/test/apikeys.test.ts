import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, authenticateApiKey, cancelDocument, createApiKey, createBusiness, createParty, issueDocument, listApiKeys, removeMember, resolveTenant, revokeApiKey,
  saveDraft, saveLateFeeConfig, ForbiddenError, ValidationError, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const bearer = (k: string) => `Bearer ${k}`;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [u, s, a] = [await mk('o@e.test'), await mk('s@e.test'), await mk('a@e.test')];
  const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u, bid, s, 'staff'); await addMember(db.web, u, bid, a, 'accountant');
  owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid); accountant = await resolveTenant(db.web, a, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('API keys', () => {
  it('are made by the owner, shown once, and stored only as a hash', async () => {
    const k = await createApiKey(db.web, owner, { name: 'Zapier', scope: 'write' });
    expect(k.key).toMatch(/^kora_[A-Za-z0-9_-]{32}$/);
    expect(k.prefix).toBe(k.key.slice(0, 10));
    const stored = await db.owner`select encode(key_hash, 'hex') as h, prefix, scope from api_key where id = ${k.id}`;
    expect(stored[0]!.h).toHaveLength(64);
    expect(JSON.stringify(await db.owner`select * from api_key where id = ${k.id}`)).not.toContain(k.key);
    expect(JSON.stringify(await db.owner`select * from audit_log where table_name = 'api_key'`)).not.toContain(k.key);   // not in the activity log either
    const list = await listApiKeys(db.web, owner);
    expect(list.find((x) => x.id === k.id)).toMatchObject({ name: 'Zapier', prefix: k.prefix, scope: 'write', last_used_at: null, revoked_at: null });
    expect(JSON.stringify(list)).not.toContain(k.key);
  });

  it('can only be managed by the owner, and need a name and a scope', async () => {
    for (const t of [staff, accountant]) {
      expect(await fails(createApiKey(db.web, t, { name: 'x', scope: 'read' }))).toBeInstanceOf(ForbiddenError);
      expect(await fails(listApiKeys(db.web, t))).toBeInstanceOf(ForbiddenError);
      expect(await fails(revokeApiKey(db.web, t, '00000000-0000-0000-0000-000000000000'))).toBeInstanceOf(ForbiddenError);
    }
    expect(await fails(createApiKey(db.web, owner, { name: '  ', scope: 'read' }))).toBeInstanceOf(ValidationError);
    expect(await fails(createApiKey(db.web, owner, { name: 'x', scope: 'admin' as never }))).toBeInstanceOf(ValidationError);
    expect(await fails(createApiKey(db.web, owner, { name: 'x'.repeat(81), scope: 'read' }))).toBeInstanceOf(ValidationError);
  });

  it('act as a staff member (write) or an accountant (read), and never as an owner', async () => {
    const w = await createApiKey(db.web, owner, { name: 'writer', scope: 'write' });
    const r = await createApiKey(db.web, owner, { name: 'reader', scope: 'read' });
    const aw = (await authenticateApiKey(db.web, bearer(w.key)))!, ar = (await authenticateApiKey(db.web, bearer(r.key)))!;
    expect(aw).toMatchObject({ scope: 'write', t: { businessId: owner.businessId, role: 'staff', userId: owner.userId } });
    expect(ar).toMatchObject({ scope: 'read', t: { role: 'accountant' } });

    const party = await createParty(db.web, aw.t, { kind: 'customer', name: 'Via API', stateCode: '27' });
    const draft = await saveDraft(db.web, aw.t, { docType: 'tax_invoice', partyId: party, lines: [{ name: 'X', hsnSac: '8471', quantity: '1', rate: '100', taxRateBp: 1800 }] });
    await issueDocument(db.web, aw.t, draft.id);
    expect(await fails(createParty(db.web, ar.t, { kind: 'customer', name: 'Nope', stateCode: '27' }))).toBeInstanceOf(ForbiddenError);   // a read key cannot write
    expect(await fails(cancelDocument(db.web, aw.t, draft.id, 'x'))).toBeInstanceOf(ForbiddenError);                                       // no key can cancel
    expect(await fails(saveLateFeeConfig(db.web, aw.t, { enabled: true }))).toBeInstanceOf(ForbiddenError);                                // or change settings
    expect(await fails(createApiKey(db.web, aw.t, { name: 'escalate', scope: 'write' }))).toBeInstanceOf(ForbiddenError);                  // or make more keys
  });

  it('are refused when wrong, malformed, revoked, or made by someone who has left', async () => {
    const k = await createApiKey(db.web, owner, { name: 'temp', scope: 'read' });
    expect(await authenticateApiKey(db.web, bearer(k.key))).not.toBeNull();
    const wrongLast = k.key.slice(0, -1) + (k.key.endsWith('A') ? 'B' : 'A');
    for (const bad of [null, '', 'Bearer', bearer(''), bearer('kora_short'), bearer(wrongLast), bearer('kora_' + 'A'.repeat(32)), k.key, `Basic ${k.key}`, `Bearer ${k.key} extra`, bearer("kora_' or 1=1 --")]) {
      expect(await authenticateApiKey(db.web, bad), String(bad)).toBeNull();
    }
    await revokeApiKey(db.web, owner, k.id);
    expect(await authenticateApiKey(db.web, bearer(k.key))).toBeNull();
    expect(await fails(revokeApiKey(db.web, owner, k.id))).toBeInstanceOf(ValidationError);                  // already revoked

    // a key made by a staff-level person stops working when they leave; here the owner stands in via direct insert
    const [leaver] = await db.owner`insert into app_user (email) values ('leaver@e.test') returning id`;
    await addMember(db.web, owner.userId, owner.businessId, leaver!.id as string, 'owner');
    const lt = await resolveTenant(db.web, leaver!.id as string, owner.businessId);
    const lk = await createApiKey(db.web, lt, { name: 'leaver key', scope: 'write' });
    expect(await authenticateApiKey(db.web, bearer(lk.key))).not.toBeNull();
    await removeMember(db.web, owner, leaver!.id as string);
    expect(await authenticateApiKey(db.web, bearer(lk.key))).toBeNull();
  });

  it('record when they were last used, and stop at twenty live keys', async () => {
    const k = await createApiKey(db.web, owner, { name: 'used', scope: 'read' });
    await authenticateApiKey(db.web, bearer(k.key));
    expect((await listApiKeys(db.web, owner)).find((x) => x.id === k.id)!.last_used_at).not.toBeNull();
    const live = (await listApiKeys(db.web, owner)).filter((x) => !x.revoked_at).length;
    for (let i = live; i < 20; i++) await createApiKey(db.web, owner, { name: `k${i}`, scope: 'read' });
    expect((await fails(createApiKey(db.web, owner, { name: 'one too many', scope: 'read' }))).message).toMatch(/at most 20/);
  });
});
