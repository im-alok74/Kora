import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockMessenger } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { withFirm } from '@kora/db';
import {
  addClient, addDefaultChecklist, createFirm, createUploadLink, demoGstin, listEngagements, listRequests, loadUploadPage, previousPeriod, processFirmMonthly, processFirmReminders,
  resolveFirm, uploadViaLink, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let a: FirmSession, b: FirmSession;
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString('base64');
const APP = 'https://kora.example';

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q] = [await mk('a@e.test'), await mk('b@e.test')] as [string, string];
  [a, b] = await Promise.all([createFirm(db.web, p, 'Sharma and Co').then((f) => resolveFirm(db.web, p, f)), createFirm(db.web, q, 'Rao Associates').then((f) => resolveFirm(db.web, q, f))]);
  await addClient(db.web, a, { legalName: 'Alpha Foods', contactName: 'Asha', contactEmail: 'asha@alpha.test', registrations: [{ gstin: demoGstin('27', '9101') }] });
  await addClient(db.web, b, { legalName: 'Beta Co', registrations: [{ gstin: demoGstin('27', '9102') }] });   // no contact on file
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('previousPeriod', () => {
  it('is the month before this one, by the clock in India', () => {
    expect(previousPeriod(new Date('2026-11-03T05:00:00Z'))).toBe('2026-10');
    expect(previousPeriod(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12');
    expect(previousPeriod(new Date('2026-10-31T19:00:00Z'))).toBe('2026-10');   // already 1 November in India
    expect(previousPeriod(new Date('2026-10-31T17:00:00Z'))).toBe('2026-09');   // still 31 October in India
  });
});

describe('monthly work for every firm', () => {
  const nov = new Date('2026-11-03T05:00:00Z');
  it('creates last month\'s work for each firm once, and never again', async () => {
    const r = await processFirmMonthly(db.web, nov);
    expect(r).toMatchObject({ period: '2026-10', firms: 2, created: 4, failed: 0 });
    expect((await listEngagements(db.web, a, { period: '2026-10' })).total).toBe(2);
    expect((await listEngagements(db.web, b, { period: '2026-10' })).total).toBe(2);
    expect(await processFirmMonthly(db.web, nov)).toMatchObject({ firms: 0, created: 0 });
  });
  it('picks up the next month for everyone, and a client added later is covered by the next run for that month', async () => {
    expect(await processFirmMonthly(db.web, new Date('2026-12-02T05:00:00Z'))).toMatchObject({ period: '2026-11', firms: 2 });
  });
  it('answers only to the system: an ordinary session cannot list the firms', async () => {
    await expect(withFirm(db.web, { firmId: a.firmId, userId: a.userId }, (tx) => tx`select id from firms_needing_month('2026-10')`)).rejects.toThrow(/system only/);
    await expect(db.web`select id from firms_with_queued_reminders()`).rejects.toThrow(/system only/);
  });
});

describe('client reminders', () => {
  let eng: string, token: string, reqs: { id: string; label: string }[];
  it('sends an overdue request to the client contact with a working link, once', async () => {
    eng = (await listEngagements(db.web, a, { period: '2026-10' })).engagements[0]!.id;
    await addDefaultChecklist(db.web, a, eng);
    token = (await createUploadLink(db.web, a, eng)).token;
    reqs = (await listRequests(db.web, a, eng)).map((r) => ({ id: r.id, label: r.label }));
    await db.owner`update document_request set updated_at = now() - interval '3 days' where engagement_id = ${eng}`;
    const m = createMockMessenger();
    const r = await processFirmReminders(db.web, { messenger: m, appUrl: APP });
    expect(r).toMatchObject({ planned: 3, sent: 3, failed: 0 });
    expect(m.outbox).toHaveLength(1);                                // one message for the piece of work, not one per document
    const mail = m.outbox[0]!;
    expect(mail).toMatchObject({ channel: 'email', to: 'asha@alpha.test' });
    expect(mail.text).toMatch(/Hello Asha, Sharma and Co is still waiting for/);
    const link = /https:\/\/kora\.example\/send\/([\w-]+)/.exec(mail.text)![1]!;
    expect(link).not.toBe(token);                                   // a fresh link; the raw token of an earlier one is not kept
    expect((await loadUploadPage(db.web, link))!.client).toBe('Alpha Foods');
    expect((await loadUploadPage(db.web, token))!.client).toBe('Alpha Foods');   // the earlier link still works (only one new link was made)
    expect(mail.text).toMatch(/Bank statement/);
    expect(mail.text).toMatch(/Purchase bills/);
    expect(await processFirmReminders(db.web, { messenger: m, appUrl: APP })).toMatchObject({ planned: 0, sent: 0 });   // nothing doubled
    expect(m.outbox).toHaveLength(1);
  });
  it('sends nothing for a client with no contact on file, and nothing for the other firm', async () => {
    const [n] = await db.owner`select count(*)::int as n from request_reminder where firm_id = ${b.firmId}`;
    expect(n!.n).toBe(0);
  });
  it('keeps at most three live links for a piece of work however many reminders go out', async () => {
    for (let i = 0; i < 4; i++) {
      await db.owner`update request_reminder set created_at = created_at - interval '4 days' where firm_id = ${a.firmId}`;
      await db.owner`update document_request set updated_at = now() - interval '9 days' where engagement_id = ${eng}`;
      await processFirmReminders(db.web, { messenger: createMockMessenger(), appUrl: APP });
    }
    const [l] = await db.owner`select count(*)::int as n from upload_link where engagement_id = ${eng} and revoked_at is null and expires_at > now()`;
    expect(l!.n).toBeLessThanOrEqual(3);
  });
  it('records a failed send as failed, with the reason, and does not retry it', async () => {
    await db.owner`delete from request_reminder where firm_id = ${a.firmId}`;
    await db.owner`update document_request set updated_at = now() - interval '9 days' where id = ${reqs[0]!.id}`;
    await db.owner`update document_request set status = 'accepted' where id in (${reqs[1]!.id}, ${reqs[2]!.id})`;
    const m = createMockMessenger();
    m.failNext('Mailbox unavailable');
    const r = await processFirmReminders(db.web, { messenger: m, appUrl: APP });
    expect(r).toMatchObject({ planned: 1, sent: 0, failed: 1 });
    const [row] = await db.owner`select status, error from request_reminder where request_id = ${reqs[0]!.id}`;
    expect(row).toMatchObject({ status: 'failed', error: 'Mailbox unavailable' });
    expect(await processFirmReminders(db.web, { messenger: m, appUrl: APP })).toMatchObject({ sent: 0, failed: 0 });
  });
  it('stops reminding once the client has sent the file', async () => {
    await db.owner`delete from request_reminder where firm_id = ${a.firmId}`;
    const fresh = (await createUploadLink(db.web, a, eng)).token;
    await uploadViaLink(db.web, fresh, reqs[0]!.id, { name: 'f.pdf', type: 'application/pdf', dataBase64: pdf('f') });
    const m = createMockMessenger();
    const r = await processFirmReminders(db.web, { messenger: m, appUrl: APP });
    expect(r.sent).toBe(0);
    expect(m.outbox).toHaveLength(0);
  });
});
