import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  adminAudit, adminBreaches, adminBusiness, adminBusinesses, adminEmails, adminOverview, adminPrivacyRequests, adminRecordBreach, adminResolvePrivacyRequest,
  adminRetryJobs, adminRevokeSessions, adminSetPlan, adminUpdateBreach, adminUsers, createBusiness, getPlan, isAdminUser, openPrivacyRequest, resolveTenant, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let t: TenantSession;
let admin = '', member = '';

beforeAll(async () => {
  db = await makeTestDb();
  admin = (await db.owner`insert into app_user (email, display_name) values ('boss@kora.test', 'Boss') returning id`)[0]!.id as string;
  member = (await db.owner`insert into app_user (email, display_name) values ('owner@shop.test', 'Shop') returning id`)[0]!.id as string;
  const bid = await createBusiness(db.web, member, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  t = await resolveTenant(db.web, member, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('who is an admin', () => {
  it('is only a user whose e-mail is on the list, case aside', async () => {
    const env = { KORA_ADMIN_EMAILS: ' Boss@Kora.test , other@kora.test' };
    expect(adminEmails(env)).toEqual(['boss@kora.test', 'other@kora.test']);
    expect(await isAdminUser(db.web, admin, env)).toBe(true);
    expect(await isAdminUser(db.web, member, env)).toBe(false);
    expect(await isAdminUser(db.web, admin, {})).toBe(false);
  });
});

describe('the panel', () => {
  it('shows totals and finds a business by name or GSTIN', async () => {
    const o = await adminOverview(db.web);
    expect(Number(o.businesses)).toBe(1);
    expect(o.mrrPaise).toBe('0');
    expect(await adminBusinesses(db.web, 'acme')).toHaveLength(1);
    expect(await adminBusinesses(db.web, '27AAPFU')).toHaveLength(1);
    expect(await adminBusinesses(db.web, 'nobody')).toHaveLength(0);
    const b = await adminBusiness(db.web, t.businessId);
    expect((b.members as unknown[]).length).toBe(1);
  });
  it('finds users', async () => {
    expect((await adminUsers(db.web, 'owner@')).length).toBe(1);
  });
  it('sets a plan only with a reason, and logs who did it', async () => {
    await expect(adminSetPlan(db.web, admin, { businessId: t.businessId, plan: 'business', status: 'active' })).rejects.toThrow(/Say why/);
    await expect(adminSetPlan(db.web, admin, { businessId: t.businessId, plan: 'gold', status: 'active', note: 'x' })).rejects.toThrow(/starter, business or firm/);
    await adminSetPlan(db.web, admin, { businessId: t.businessId, plan: 'business', status: 'trialing', validUntil: new Date(Date.now() + 14 * 86_400_000).toISOString(), note: 'two week trial agreed on call' });
    expect((await getPlan(db.web, t)).plan.id).toBe('business');
    const log = await adminAudit(db.web) as { action: string; admin: string }[];
    expect(log[0]).toMatchObject({ action: 'plan.set', admin: 'boss@kora.test' });
  });
  it('does not let the application role read or edit the log', async () => {
    await expect(db.web`select * from admin_audit`).rejects.toThrow();
    await expect(db.web`delete from admin_audit`).rejects.toThrow();
  });
  it('signs a user out everywhere', async () => {
    await db.owner`insert into app_session (user_id, token_hash, expires_at) values (${member}, decode('00', 'hex'), now() + interval '1 day')`;
    expect(await adminRevokeSessions(db.web, admin, member)).toBe(1);
  });
  it('retries failed jobs and says how many', async () => {
    await db.owner`insert into job (queue, payload, status, attempts, max_attempts) values ('delivery', '{}', 'failed', 8, 8)`;
    expect(await adminRetryJobs(db.web, admin, 'delivery')).toBe(1);
    expect(await adminRetryJobs(db.web, admin)).toBe(0);
  });
});

describe('DPDP work in the panel', () => {
  it('lists a privacy request, resolves it with an answer, and refuses to close without one', async () => {
    const r = await openPrivacyRequest(db.web, member, { kind: 'erasure' });
    const open = await adminPrivacyRequests(db.web, true) as { id: string; who: string }[];
    expect(open.map((x) => x.id)).toContain(r.id);
    await expect(adminResolvePrivacyRequest(db.web, admin, { id: r.id, status: 'done' })).rejects.toThrow(/answer/);
    await adminResolvePrivacyRequest(db.web, admin, { id: r.id, status: 'done', resolution: 'Personal details erased on 28 October.' });
    expect(await adminPrivacyRequests(db.web, true)).toHaveLength(0);
    const [row] = await db.owner`select status, resolution, resolved_at from privacy_request where id = ${r.id}`;
    expect(row).toMatchObject({ status: 'done', resolution: 'Personal details erased on 28 October.' });
  });
  it('records a breach and the dates the Board and the people were told', async () => {
    const id = await adminRecordBreach(db.web, admin, { discoveredAt: '2026-10-20T10:00:00Z', summary: 'An old export link was shared by mistake', peopleAffected: 3 });
    expect((await adminOverview(db.web)).breachesOpen).toBe(1);
    await adminUpdateBreach(db.web, admin, { id, contained: true, boardNotifiedAt: '2026-10-21T10:00:00Z', peopleNotifiedAt: '2026-10-21T12:00:00Z' });
    const [b] = await adminBreaches(db.web) as { contained: boolean; board_notified_at: string }[];
    expect(b!.contained).toBe(true);
    expect(b!.board_notified_at).toBeTruthy();
    expect((await adminOverview(db.web)).breachesOpen).toBe(0);
    await expect(adminRecordBreach(db.web, admin, { discoveredAt: 'soon', summary: 'x' })).rejects.toThrow(/When was it found/);
  });
});
