import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  createBusiness, createParty, getCustomerReminder, issueDocument, listReminders, offsetLabel, previewReminder, recordPayment, reminderHistory, resolveTenant,
  saveCustomerReminder, saveDraft, saveMessageTemplates, saveReminderConfig, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let early: string, quiet: string, plain: string;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const inv = (partyId: string, dueDays: number): DocIn => ({ docType: 'tax_invoice', partyId, docDate: future(-1), dueDate: future(dueDays), lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000.00', taxRateBp: 1800 }] });
const issue = async (partyId: string, dueDays: number) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, inv(partyId, dueDays))).id)).document;
const offsetsOf = async (docId: string) => {
  const rows = await db.owner`select scheduled_at, delivery_status from reminder where document_id = ${docId} order by scheduled_at`;
  return rows.filter((r) => r.delivery_status === 'scheduled').length;
};

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('r@e.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  await saveReminderConfig(db.web, owner, { enabled: true, channel: 'whatsapp', offsets: [-2, 3, 7] });
  early = await createParty(db.web, owner, { kind: 'customer', name: 'Early Bird Co', stateCode: '27', phone: '9876543210' });
  quiet = await createParty(db.web, owner, { kind: 'customer', name: 'Quiet Ltd', stateCode: '27', phone: '9876543211', email: 'q@quiet.test' });
  plain = await createParty(db.web, owner, { kind: 'customer', name: 'Plain Stores', stateCode: '27', phone: '9876543212' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('a schedule for one customer', () => {
  it('follows the business until the customer gets their own', async () => {
    const g = await getCustomerReminder(db.web, owner, plain);
    expect(g.usingBusinessDefault).toBe(true);
    expect(g.effective.offsets).toEqual([-2, 3, 7]);
    const d = await issue(plain, 30);
    expect(await offsetsOf(d.id as string)).toBe(3);
  });
  it('replans the open invoices when it changes, and puts them back when it is removed', async () => {
    const d = await issue(early, 30);
    expect(await offsetsOf(d.id as string)).toBe(3);
    const s = await saveCustomerReminder(db.web, owner, early, { enabled: true, channel: 'sms', offsets: [-7, -1, 0, 5, 15] });
    expect(s.usingBusinessDefault).toBe(false);
    expect(await offsetsOf(d.id as string)).toBe(5);
    expect((await listReminders(db.web, owner, d.id as string)).filter((r) => r.delivery_status === 'scheduled').every((r) => r.channel === 'sms')).toBe(true);
    // a new invoice uses it too
    const d2 = await issue(early, 20);
    expect(await offsetsOf(d2.id as string)).toBe(5);
    await saveCustomerReminder(db.web, owner, early, null);
    expect(await offsetsOf(d.id as string)).toBe(3);
  });
  it('can switch reminders off for one customer, and they stop when the invoice is paid', async () => {
    await saveCustomerReminder(db.web, owner, quiet, { enabled: false, channel: 'whatsapp', offsets: [-2, 3] });
    const d = await issue(quiet, 30);
    expect(await offsetsOf(d.id as string)).toBe(0);
    await saveCustomerReminder(db.web, owner, quiet, { enabled: true, channel: 'email', offsets: [3] });
    expect(await offsetsOf(d.id as string)).toBe(1);
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'cash' });
    expect(await offsetsOf(d.id as string)).toBe(0);
  });
  it('refuses a schedule that makes no sense', async () => {
    await expect(saveCustomerReminder(db.web, owner, plain, { enabled: true, channel: 'fax', offsets: [1] })).rejects.toThrow(/WhatsApp, SMS or email/);
    await expect(saveCustomerReminder(db.web, owner, plain, { enabled: true, channel: 'sms', offsets: [500] })).rejects.toThrow(/up to 6/);
    await expect(saveCustomerReminder(db.web, owner, '00000000-0000-0000-0000-000000000000', null)).rejects.toThrow(/not found/);
  });
});

describe('preview and history', () => {
  it('shows the message the customer will read, with the business wording, and when each reminder goes', async () => {
    await saveMessageTemplates(db.web, owner, { reminder: 'Hi {customer}, {outstanding} is pending on {number}. Pay here: {link}' });
    const d = await issue(plain, 10);
    const p = await previewReminder(db.web, owner, { partyId: plain, documentId: d.id as string });
    expect(p.text).toContain('Hi Plain Stores, Rs 1,180.00 is pending on');
    expect(p.text).toContain('Pay here: https://');
    expect(p.to).toBe('9876543212');
    expect(p.schedule.map((s) => s.label)).toEqual(['2 days before the due date', '3 days after the due date', '7 days after the due date']);
    // preview an unsaved schedule
    const p2 = await previewReminder(db.web, owner, { partyId: plain, config: { enabled: true, channel: 'email', offsets: [0] } });
    expect(p2.schedule.map((s) => s.label)).toEqual(['On the due date']);
    expect(p2.channel).toBe('email');
  });
  it('says so when there is nothing unpaid to preview', async () => {
    const lone = await createParty(db.web, owner, { kind: 'customer', name: 'Nothing Owed', stateCode: '27' });
    const p = await previewReminder(db.web, owner, { partyId: lone });
    expect(p.text).toBeNull();
  });
  it('lists what was sent, for the customer and for the business', async () => {
    const d = await issue(plain, 5);
    await db.owner`update reminder set delivery_status = 'sent' where document_id = ${d.id as string} and id = (select id from reminder where document_id = ${d.id as string} order by scheduled_at limit 1)`;
    const mine = await reminderHistory(db.web, owner, { partyId: plain });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ customer: 'Plain Stores', delivery_status: 'sent' });
    expect((await reminderHistory(db.web, owner)).length).toBeGreaterThanOrEqual(1);
    expect(await reminderHistory(db.web, owner, { partyId: early })).toEqual([]);
  });
  it('words the offsets plainly', () => { expect(offsetLabel(0)).toBe('On the due date'); expect(offsetLabel(-1)).toBe('1 day before the due date'); expect(offsetLabel(10)).toBe('10 days after the due date'); });
});
