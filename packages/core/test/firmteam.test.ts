import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { answerFirmInvite, createFirm, inviteFirmMember, listFirmInvites, listFirmMembers, listFirms, removeFirmMemberChecked, resolveFirm, type FirmSession } from '../src/index.js';

let db: TestDb;
let partner: FirmSession;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('p@e.test') returning id`;
  partner = await resolveFirm(db.web, u!.id as string, await createFirm(db.web, u!.id as string, 'Sharma and Co'));
}, 60_000);
afterAll(async () => { await db?.drop(); });

const people = async () => (await listFirmMembers(db.web, partner)).filter((m) => m.active).map((m) => `${m.email}:${m.role}${m.pending ? ':pending' : ''}`).sort();
const userOf = async (email: string) => (await listFirmMembers(db.web, partner)).find((m) => m.email === email)!.userId;
/** The invitee signs in and says yes. */
const accept = async (email: string) => answerFirmInvite(db.web, await userOf(email), partner.firmId, true);

describe('team', () => {
  it('invites a person by email, creating their account; they are not in the firm until they accept', async () => {
    const r = await inviteFirmMember(db.web, partner, { identifier: ' Asha@Firm.TEST ', role: 'preparer' });
    expect(await people()).toEqual(['asha@firm.test:preparer:pending', 'p@e.test:partner']);
    await expect(resolveFirm(db.web, r.userId, partner.firmId)).rejects.toThrow(/firm role/);   // the firm's data stays closed
    expect(await listFirms(db.web, r.userId)).toEqual([]);
    expect(await listFirmInvites(db.web, r.userId)).toEqual([{ firmId: partner.firmId, name: 'Sharma and Co', role: 'preparer' }]);
    await answerFirmInvite(db.web, r.userId, partner.firmId, true);
    expect((await resolveFirm(db.web, r.userId, partner.firmId)).role).toBe('preparer');
    expect((await listFirms(db.web, r.userId))[0]!.name).toBe('Sharma and Co');
    expect(await listFirmInvites(db.web, r.userId)).toEqual([]);
    expect(await people()).toEqual(['asha@firm.test:preparer', 'p@e.test:partner']);
  });
  it('lets the invited person decline, and nothing was ever opened to them', async () => {
    const r = await inviteFirmMember(db.web, partner, { identifier: 'decliner@firm.test', role: 'reviewer' });
    await answerFirmInvite(db.web, r.userId, partner.firmId, false);
    await expect(resolveFirm(db.web, r.userId, partner.firmId)).rejects.toThrow(/firm role/);
    expect(await listFirmInvites(db.web, r.userId)).toEqual([]);
    await expect(answerFirmInvite(db.web, r.userId, partner.firmId, true)).rejects.toThrow(/no invitation/);   // a declined invitation cannot be revived by the invitee
    expect(await people()).toEqual(['asha@firm.test:preparer', 'p@e.test:partner']);
  });
  it('does not let a stranger answer someone else\'s invitation', async () => {
    const r = await inviteFirmMember(db.web, partner, { identifier: 'target@firm.test', role: 'manager' });
    const [x] = await db.owner`insert into app_user (email) values ('x@firm.test') returning id`;
    await expect(answerFirmInvite(db.web, x!.id as string, partner.firmId, true)).rejects.toThrow(/no invitation/);
    await expect(resolveFirm(db.web, r.userId, partner.firmId)).rejects.toThrow(/firm role/);
    await answerFirmInvite(db.web, r.userId, partner.firmId, false);
  });
  it('invites by mobile number', async () => {
    await inviteFirmMember(db.web, partner, { identifier: '9876543210', role: 'reviewer' });
    expect((await people()).some((p) => /9876543210.*:reviewer:pending/.test(p))).toBe(true);
    await removeFirmMemberChecked(db.web, partner, await userOf((await listFirmMembers(db.web, partner)).find((m) => /9876543210/.test(m.email))!.email));
  });
  it('changes the role of someone already in the firm without asking them again, and does not duplicate', async () => {
    await inviteFirmMember(db.web, partner, { identifier: 'asha@firm.test', role: 'manager' });
    expect((await people()).filter((p) => p.startsWith('asha@'))).toEqual(['asha@firm.test:manager']);
  });
  it('refuses an unknown role, a bad address, and anyone but a partner', async () => {
    await expect(inviteFirmMember(db.web, partner, { identifier: 'x@y.test', role: 'boss' })).rejects.toThrow(/Choose partner/);
    await expect(inviteFirmMember(db.web, partner, { identifier: 'not-an-address', role: 'preparer' })).rejects.toThrow();
    const asManager = await resolveFirm(db.web, await userOf('asha@firm.test'), partner.firmId);
    await expect(inviteFirmMember(db.web, asManager, { identifier: 'z@y.test', role: 'preparer' })).rejects.toThrow(/firm role/);
  });
  it('keeps at least one partner, counting only partners who have accepted', async () => {
    await expect(inviteFirmMember(db.web, partner, { identifier: 'p@e.test', role: 'manager' })).rejects.toThrow(/at least one partner/);
    await expect(removeFirmMemberChecked(db.web, partner, partner.userId)).rejects.toThrow(/at least one partner/);
    await inviteFirmMember(db.web, partner, { identifier: 'asha@firm.test', role: 'partner' });   // already in: role change, effective at once
    await inviteFirmMember(db.web, partner, { identifier: 'p@e.test', role: 'manager' });          // allowed: Asha is also a partner
    expect((await people()).filter((p) => p.endsWith(':partner'))).toEqual(['asha@firm.test:partner']);
  });
  it('a pending partner invitation does not count as a partner', async () => {
    const ashaS = await resolveFirm(db.web, await userOf('asha@firm.test'), partner.firmId);
    await inviteFirmMember(db.web, ashaS, { identifier: 'newpartner@firm.test', role: 'partner' });   // invited, not yet accepted
    await expect(removeFirmMemberChecked(db.web, ashaS, ashaS.userId)).rejects.toThrow(/at least one partner/);
    await removeFirmMemberChecked(db.web, ashaS, await userOf('newpartner@firm.test'));
  });
  it('removes a member, who then loses the firm; adding them back needs them to accept again', async () => {
    const ashaS = await resolveFirm(db.web, await userOf('asha@firm.test'), partner.firmId);
    const p = await userOf('p@e.test');
    await removeFirmMemberChecked(db.web, ashaS, p);
    await expect(resolveFirm(db.web, p, partner.firmId)).rejects.toThrow(/firm role/);
    await inviteFirmMember(db.web, ashaS, { identifier: 'p@e.test', role: 'reviewer' });
    await expect(resolveFirm(db.web, p, partner.firmId)).rejects.toThrow(/firm role/);   // invited again, not yet back
    await accept('p@e.test');
    expect((await resolveFirm(db.web, p, partner.firmId)).role).toBe('reviewer');
  });
});
