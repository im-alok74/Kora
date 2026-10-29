import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, createRecurring, getPlan, inviteMember, issueDocument, queueDocumentSend, resolveTenant, saveDraft, saveReminderConfig, usageSummary, type TenantSession } from '../src/index.js';

let db: TestDb;
let t: TenantSession;
let party: string;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('plan@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  t = await resolveTenant(db.web, u!.id as string, bid);
  party = await createParty(db.web, t, { kind: 'customer', name: 'Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });
beforeEach(() => { process.env.KORA_PLANS = 'enforce'; });
afterEach(() => { delete process.env.KORA_PLANS; });

const draft = (docType = 'tax_invoice') => saveDraft(db.web, t, { docType: docType as 'tax_invoice', partyId: party, docDate: '2026-10-01', lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }] });
const setPlan = (plan: string, status: string, validUntil: string | null) => db.owner`select set_business_plan(${t.businessId}, ${plan}, ${status}, ${validUntil}::timestamptz)`;

describe('free plan limits', () => {
  it('is the plan when nothing is set, and allows 10 invoices a month, then says why the 11th is refused', async () => {
    expect((await getPlan(db.web, t)).plan.id).toBe('starter');
    for (let i = 0; i < 10; i++) await issueDocument(db.web, t, (await draft()).id);
    await expect(issueDocument(db.web, t, (await draft()).id)).rejects.toThrow(/10 invoices and quotes a month/);
    expect((await usageSummary(db.web, t)).usage.invoicesThisMonth).toBe(10);
  });
  it('never limits credit notes, which correct an invoice', async () => {
    const [inv] = await db.owner`select id from document where business_id = ${t.businessId} and status = 'issued' limit 1`;
    const { startNote } = await import('../src/index.js');
    const note = await startNote(db.web, t, inv!.id as string, 'credit_note');
    await expect(issueDocument(db.web, t, note.id)).resolves.toBeTruthy();
  });
  it('keeps messaging, reminders and recurring invoices for paid plans', async () => {
    const [inv] = await db.owner`select id from document where business_id = ${t.businessId} and doc_type = 'tax_invoice' and status = 'issued' limit 1`;
    await expect(queueDocumentSend(db.web, t, { documentId: inv!.id as string, channel: 'email', to: 'x@example.test' })).rejects.toThrow(/not part of the Starter plan/);
    await expect(saveReminderConfig(db.web, t, { enabled: true, channel: 'sms', offsets: [3] })).rejects.toThrow(/Payment reminders/);
    await expect(saveReminderConfig(db.web, t, { enabled: false })).resolves.toBeTruthy();
    await expect(createRecurring(db.web, t, { name: 'Monthly', partyId: party, docType: 'tax_invoice', everyN: 1, unit: 'month', startDate: '2026-11-01', lines: [] } as never)).rejects.toThrow(/Recurring invoices/);
  });
  it('has room for one person', async () => {
    await expect(inviteMember(db.web, t, { identifier: 'second@example.test', role: 'staff' })).rejects.toThrow(/room for 1 person/);
  });
});

describe('paid plans', () => {
  it('lift the limits while paid up', async () => {
    await setPlan('business', 'active', new Date(Date.now() + 30 * 86_400_000).toISOString());
    expect((await getPlan(db.web, t)).plan.id).toBe('business');
    await expect(issueDocument(db.web, t, (await draft()).id)).resolves.toBeTruthy();
    await expect(inviteMember(db.web, t, { identifier: 'second@example.test', role: 'staff' })).resolves.toBeTruthy();
  });
  it('stay for a week after the period ends, then fall back to the free plan', async () => {
    await setPlan('business', 'past_due', new Date(Date.now() - 3 * 86_400_000).toISOString());
    expect((await getPlan(db.web, t)).plan.id).toBe('business');
    await setPlan('business', 'active', new Date(Date.now() - 9 * 86_400_000).toISOString());
    const ep = await getPlan(db.web, t);
    expect(ep.plan.id).toBe('starter');
    expect(ep.lapsed).toBe(true);
  });
  it('are not enforced unless KORA_PLANS=enforce', async () => {
    delete process.env.KORA_PLANS;
    await expect(issueDocument(db.web, t, (await draft()).id)).resolves.toBeTruthy();
  });
  it('cannot be set from a tenant connection', async () => {
    await expect(db.web`insert into business_plan (business_id, plan, status) values (${t.businessId}, 'firm', 'active')`).rejects.toThrow();
    await expect(db.web`update business_plan set plan = 'firm'`).rejects.toThrow();
  });
});
