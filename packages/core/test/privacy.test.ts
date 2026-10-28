import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { consentStates, listPrivacyRequests, NOTICE_VERSION, openPrivacyRequest, personalDataExport, setConsent } from '../src/index.js';

let db: TestDb;
let a = '', b = '';
beforeAll(async () => {
  db = await makeTestDb();
  a = (await db.owner`insert into app_user (email, display_name) values ('a@example.test', 'a') returning id`)[0]!.id as string;
  b = (await db.owner`insert into app_user (email, display_name) values ('b@example.test', 'b') returning id`)[0]!.id as string;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('consent (DPDP)', () => {
  it('starts as not given, records decisions, and keeps the history when one is withdrawn', async () => {
    expect((await consentStates(db.web, a)).every((c) => !c.given)).toBe(true);
    await setConsent(db.web, a, 'terms_privacy', true, 'signup');
    await setConsent(db.web, a, 'product_updates', true, 'privacy_page');
    await setConsent(db.web, a, 'product_updates', false, 'privacy_page');
    const s = Object.fromEntries((await consentStates(db.web, a)).map((c) => [c.purpose, c]));
    expect(s.terms_privacy!.given).toBe(true);
    expect(s.terms_privacy!.noticeVersion).toBe(NOTICE_VERSION);
    expect(s.product_updates!.given).toBe(false);
    const [n] = await db.owner`select count(*)::int as n from consent_event where user_id = ${a} and purpose = 'product_updates'`;
    expect(n!.n).toBe(2);
  });
  it('cannot withdraw the terms on their own, and rejects unknown purposes', async () => {
    await expect(setConsent(db.web, a, 'terms_privacy', false, 'privacy_page')).rejects.toThrow(/close your account/);
    await expect(setConsent(db.web, a, 'sell_my_data', true, 'x')).rejects.toThrow(/Unknown/);
  });
  it('is private to the person: another user sees nothing, and nobody can edit history', async () => {
    expect((await consentStates(db.web, b)).every((c) => !c.given)).toBe(true);
    await expect(db.web`update consent_event set action = 'given'`).rejects.toThrow();
    await expect(db.web`delete from consent_event`).rejects.toThrow();
  });
});

describe('privacy requests (DPDP)', () => {
  it('opens a request due in 30 days and lists only the person\'s own', async () => {
    const r = await openPrivacyRequest(db.web, a, { kind: 'access' });
    const days = (new Date(r.dueAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect((await listPrivacyRequests(db.web, a)).map((x) => x.kind)).toEqual(['access']);
    expect(await listPrivacyRequests(db.web, b)).toEqual([]);
  });
  it('asks for details on a grievance, rejects odd kinds, and caps open requests', async () => {
    await expect(openPrivacyRequest(db.web, b, { kind: 'grievance' })).rejects.toThrow(/little more/);
    await expect(openPrivacyRequest(db.web, b, { kind: 'sell' })).rejects.toThrow(/Choose/);
    for (let i = 0; i < 5; i++) await openPrivacyRequest(db.web, b, { kind: 'erasure' });
    await expect(openPrivacyRequest(db.web, b, { kind: 'erasure' })).rejects.toThrow(/several open/);
  });
  it('cannot be marked done by the person, only by an admin function', async () => {
    await expect(db.web`update privacy_request set status = 'done', resolved_at = now()`).rejects.toThrow();
  });
});

describe('right of access', () => {
  it('returns the person\'s profile, consents and requests, and not another person\'s', async () => {
    const x = await personalDataExport(db.web, a);
    expect(x.profile?.email).toBe('a@example.test');
    expect(x.consents.length).toBeGreaterThan(0);
    expect(x.privacyRequests).toHaveLength(1);
    expect(JSON.stringify(x)).not.toContain('b@example.test');
  });
});
