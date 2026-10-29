import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addFirmMember, createBusiness, createFirm, inFirm, listFirmMembers, listFirms, removeFirmMember, resolveFirm, resolveTenant } from '../src/index.js';

let db: TestDb;
let p1: string, p2: string, prep: string, outsider: string;
let f1: string, f2: string;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  [p1, p2, prep, outsider] = [await mk('p1@e.test'), await mk('p2@e.test'), await mk('prep@e.test'), await mk('out@e.test')] as [string, string, string, string];
  f1 = await createFirm(db.web, p1, 'Sharma and Co');
  f2 = await createFirm(db.web, p2, 'Rao Associates');
  await addFirmMember(db.web, p1, f1, prep, 'preparer');
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('firm tenancy', () => {
  it('lists only the firms a person works in, and the creator is a partner', async () => {
    expect(await listFirms(db.web, p1)).toEqual([{ firmId: f1, name: 'Sharma and Co', role: 'partner' }]);
    expect(await listFirms(db.web, prep)).toEqual([{ firmId: f1, name: 'Sharma and Co', role: 'preparer' }]);
    expect(await listFirms(db.web, outsider)).toEqual([]);
  });
  it('refuses a person who is not in the firm', async () => {
    await expect(resolveFirm(db.web, p2, f1)).rejects.toThrow(/firm role/);
    await expect(resolveFirm(db.web, outsider, f1)).rejects.toThrow(/firm role/);
  });
  it('keeps one firm out of another firm even with a valid session', async () => {
    const s1 = await resolveFirm(db.web, p1, f1);
    const members = await listFirmMembers(db.web, s1);
    expect(members.map((m) => m.email).sort()).toEqual(['p1@e.test', 'prep@e.test']);
    expect(await inFirm(db.web, s1, 'firm.read', (tx) => tx`select id from firm_member where firm_id = ${f2}`)).toHaveLength(0);
    expect(await inFirm(db.web, s1, 'firm.read', (tx) => tx`select id from firm where id = ${f2}`)).toHaveLength(0);
  });
  it('lets only a partner add or remove members', async () => {
    await expect(addFirmMember(db.web, prep, f1, outsider, 'reviewer')).rejects.toThrow(/only a partner/);
    await expect(removeFirmMember(db.web, prep, f1, p1)).rejects.toThrow(/only a partner/);
    const s = await resolveFirm(db.web, prep, f1);
    expect(() => inFirm(db.web, s, 'member.manage', async () => 1)).toThrow(/firm role/);
  });
  it('does not let the last partner be removed, and a removed member loses access', async () => {
    await expect(removeFirmMember(db.web, p1, f1, p1)).rejects.toThrow(/at least one partner/);
    await removeFirmMember(db.web, p1, f1, prep);
    await expect(resolveFirm(db.web, prep, f1)).rejects.toThrow(/firm role/);
    expect(await listFirms(db.web, prep)).toEqual([]);
    await addFirmMember(db.web, p1, f1, prep, 'reviewer');
    expect((await resolveFirm(db.web, prep, f1)).role).toBe('reviewer');
  });
  it('gives no access to a business just because the person is in a firm', async () => {
    const biz = await createBusiness(db.web, p2, { legalName: 'Client Ltd', gstin: null, stateCode: '27', registrationType: 'unregistered' });
    await expect(resolveTenant(db.web, p1, biz)).rejects.toThrow();
  });
});
