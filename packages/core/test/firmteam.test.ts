import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createFirm, inviteFirmMember, listFirmMembers, listFirms, removeFirmMemberChecked, resolveFirm, type FirmSession } from '../src/index.js';

let db: TestDb;
let partner: FirmSession;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('p@e.test') returning id`;
  partner = await resolveFirm(db.web, u!.id as string, await createFirm(db.web, u!.id as string, 'Sharma and Co'));
}, 60_000);
afterAll(async () => { await db?.drop(); });

const people = async () => (await listFirmMembers(db.web, partner)).filter((m) => m.active).map((m) => `${m.email}:${m.role}`).sort();

describe('team', () => {
  it('adds a person by email, creating their account, and sees them in the firm', async () => {
    const r = await inviteFirmMember(db.web, partner, { identifier: ' Asha@Firm.TEST ', role: 'preparer' });
    expect(await people()).toEqual(['asha@firm.test:preparer', 'p@e.test:partner']);
    const asha = await resolveFirm(db.web, r.userId, partner.firmId);
    expect(asha.role).toBe('preparer');
    expect((await listFirms(db.web, r.userId))[0]!.name).toBe('Sharma and Co');
  });
  it('adds a person by mobile number', async () => {
    await inviteFirmMember(db.web, partner, { identifier: '9876543210', role: 'reviewer' });
    expect((await people()).some((p) => /9876543210.*:reviewer/.test(p))).toBe(true);
  });
  it('changes a role by inviting again, and does not duplicate', async () => {
    await inviteFirmMember(db.web, partner, { identifier: 'asha@firm.test', role: 'manager' });
    expect((await people()).filter((p) => p.startsWith('asha@'))).toEqual(['asha@firm.test:manager']);
  });
  it('refuses an unknown role, a bad address, and anyone but a partner', async () => {
    await expect(inviteFirmMember(db.web, partner, { identifier: 'x@y.test', role: 'boss' })).rejects.toThrow(/Choose partner/);
    await expect(inviteFirmMember(db.web, partner, { identifier: 'not-an-address', role: 'preparer' })).rejects.toThrow();
    const m = (await listFirmMembers(db.web, partner)).find((x) => x.email === 'asha@firm.test')!;
    const asManager = await resolveFirm(db.web, m.userId, partner.firmId);
    await expect(inviteFirmMember(db.web, asManager, { identifier: 'z@y.test', role: 'preparer' })).rejects.toThrow(/firm role/);
  });
  it('keeps at least one partner, whether by demotion or removal', async () => {
    await expect(inviteFirmMember(db.web, partner, { identifier: 'p@e.test', role: 'manager' })).rejects.toThrow(/at least one partner/);
    await expect(removeFirmMemberChecked(db.web, partner, partner.userId)).rejects.toThrow(/at least one partner/);
    await inviteFirmMember(db.web, partner, { identifier: 'asha@firm.test', role: 'partner' });
    await inviteFirmMember(db.web, partner, { identifier: 'p@e.test', role: 'manager' });   // allowed now: Asha is also a partner
    expect((await people()).filter((p) => p.endsWith(':partner'))).toEqual(['asha@firm.test:partner']);
  });
  it('removes a member, who then loses the firm, and can be added back', async () => {
    const asha = (await listFirmMembers(db.web, partner)).find((x) => x.email === 'asha@firm.test')!;
    const p = (await listFirmMembers(db.web, partner)).find((x) => x.email === 'p@e.test')!;
    const ashaSession = await resolveFirm(db.web, asha.userId, partner.firmId);
    await removeFirmMemberChecked(db.web, ashaSession, p.userId);
    await expect(resolveFirm(db.web, p.userId, partner.firmId)).rejects.toThrow(/firm role/);
    await inviteFirmMember(db.web, ashaSession, { identifier: 'p@e.test', role: 'reviewer' });
    expect((await resolveFirm(db.web, p.userId, partner.firmId)).role).toBe('reviewer');
  });
});
