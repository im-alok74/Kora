import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addFirmMember, assignClient, assignEngagement, clearBlocker, createFirm, demoGstin, generateEngagements, listClients, listEngagements, resolveFirm,
  setBlocker, setEngagementStatus, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, rev: FirmSession, stranger: FirmSession, other: FirmSession;
let e1: string, e2: string;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, r, st, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('r@e.test'), await mk('s@e.test'), await mk('o@e.test')] as string[] as [string, string, string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao');
  await addFirmMember(db.web, p, f, q, 'preparer');
  await addFirmMember(db.web, p, f, r, 'reviewer');
  await addFirmMember(db.web, p, f, st, 'preparer');
  [partner, prep, rev, stranger, other] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f), resolveFirm(db.web, r, f), resolveFirm(db.web, st, f), resolveFirm(db.web, o, f2)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: demoGstin('27', '4001') }] });
  await generateEngagements(db.web, partner, '2026-08');
  const alpha = (await listClients(db.web, partner)).clients[0]!.id;
  await assignClient(db.web, partner, alpha, prep.userId);
  await assignClient(db.web, partner, alpha, rev.userId);
  const l = (await listEngagements(db.web, partner)).engagements;
  [e1, e2] = [l[0]!.id, l[1]!.id];
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('owner and reviewer', () => {
  it('lets a partner pick a preparer and a different reviewer', async () => {
    await assignEngagement(db.web, partner, e1, { ownerId: prep.userId, reviewerId: rev.userId });
    const e = (await listEngagements(db.web, partner)).engagements.find((x) => x.id === e1)!;
    expect(e).toMatchObject({ ownerId: prep.userId, reviewerId: rev.userId });
  });
  it('refuses the same person twice, and people outside the firm', async () => {
    await expect(assignEngagement(db.web, partner, e1, { reviewerId: prep.userId })).rejects.toThrow(/different people/);
    await expect(assignEngagement(db.web, partner, e2, { ownerId: other.userId })).rejects.toThrow(/active member/);
  });
  it('does not let a preparer assign', async () => {
    await expect(assignEngagement(db.web, prep, e1, { ownerId: prep.userId })).rejects.toThrow(/firm role/);
  });
  it('finds my work', async () => {
    expect((await listEngagements(db.web, prep, { mine: true })).engagements.map((e) => e.id)).toEqual([e1]);
    expect((await listEngagements(db.web, rev, { mine: true })).engagements.map((e) => e.id)).toEqual([e1]);
  });
});

describe('choosing people at the same moment', () => {
  it('keeps both the preparer and the reviewer when they are chosen at the same time, in either order', async () => {
    for (let i = 0; i < 6; i++) {
      await assignEngagement(db.web, partner, e2, { ownerId: null, reviewerId: null });
      await Promise.all(i % 2 ? [assignEngagement(db.web, partner, e2, { ownerId: prep.userId }), assignEngagement(db.web, partner, e2, { reviewerId: rev.userId })]
                              : [assignEngagement(db.web, partner, e2, { reviewerId: rev.userId }), assignEngagement(db.web, partner, e2, { ownerId: prep.userId })]);
      const e = (await listEngagements(db.web, partner)).engagements.find((x) => x.id === e2)!;
      expect({ owner: e.ownerId, reviewer: e.reviewerId }, `round ${i}`).toEqual({ owner: prep.userId, reviewer: rev.userId });
    }
  });
});

describe('blockers', () => {
  it('records a blocker while status moves on, then clears it', async () => {
    await setEngagementStatus(db.web, prep, e1, 'preparing');
    await setBlocker(db.web, prep, e1, { reason: 'Bank statement for August missing', party: 'client', nextAction: 'Call Asha', expected: '2026-09-05' });
    let e = (await listEngagements(db.web, partner)).engagements.find((x) => x.id === e1)!;
    expect(e.status).toBe('preparing');
    expect(e.blocker).toMatchObject({ reason: 'Bank statement for August missing', party: 'client', nextAction: 'Call Asha', expected: '2026-09-05' });
    expect((await listEngagements(db.web, partner, { blocked: true })).total).toBe(1);
    expect((await listEngagements(db.web, partner, { blocked: false })).total).toBe(1);
    const since = e.blocker!.since;
    await setBlocker(db.web, prep, e1, { reason: 'Still missing', party: 'client' });
    e = (await listEngagements(db.web, partner)).engagements.find((x) => x.id === e1)!;
    expect(e.blocker!.since).toBe(since); // age is kept when the reason is edited
    await clearBlocker(db.web, prep, e1);
    expect((await listEngagements(db.web, partner, { blocked: true })).total).toBe(0);
  });
  it('rejects an empty reason or an unknown party', async () => {
    await expect(setBlocker(db.web, prep, e1, { reason: ' ', party: 'client' })).rejects.toThrow(/holding this up/);
    await expect(setBlocker(db.web, prep, e1, { reason: 'x', party: 'nobody' as 'client' })).rejects.toThrow(/waiting on/);
  });
});

describe('closing work', () => {
  it('lets anyone who can see the client move work to review, but nobody marks it done from here', async () => {
    await setEngagementStatus(db.web, prep, e1, 'in_review');
    for (const who of [prep, rev, partner]) await expect(setEngagementStatus(db.web, who, e1, 'done')).rejects.toThrow(/closed from the Review section/);
  });
  it('lets only a closer reopen finished work', async () => {
    await db.owner`update engagement set status = 'done' where id = ${e1}`;
    await expect(setEngagementStatus(db.web, prep, e1, 'preparing')).rejects.toThrow(/reopen/);
    await setEngagementStatus(db.web, rev, e1, 'preparing');
    await db.owner`update engagement set status = 'done' where id = ${e1}`;
    await setEngagementStatus(db.web, partner, e1, 'preparing');
  });
  it('hides engagements of unassigned clients and other firms', async () => {
    await expect(setEngagementStatus(db.web, stranger, e1, 'preparing')).rejects.toThrow(/not found/);
    await expect(setBlocker(db.web, stranger, e1, { reason: 'x', party: 'firm' })).rejects.toThrow(/not found/);
    await expect(setEngagementStatus(db.web, other, e1, 'preparing')).rejects.toThrow(/not found/);
  });
  it('rejects an unknown status', async () => {
    await expect(setEngagementStatus(db.web, partner, e1, 'finished' as 'done')).rejects.toThrow(/Status must/);
  });
});
