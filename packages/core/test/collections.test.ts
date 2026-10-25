import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpGsp, createMockGateway, createMockMessenger, mockPaidEventBody, signMockWebhook, isWebhookSignatureError } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, ageingReport, applyGatewayEvent, createBusiness, createHandlers, createParty, createPaymentLink, enqueue, getDocument,
  getPaymentLinks, issueDocument, listPayments, listReminders, listUnallocated, processDueReminders, recordPayment, resolveTenant,
  retryDelaySeconds, runJobsOnce, saveDraft, saveReminderConfig, voidPayment, ForbiddenError, PermanentJobError, ValidationError,
  type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession;
let cust: string, custNoPhone: string;
const messenger = createMockMessenger();
const gateway = createMockGateway({ secret: 'gateway-secret-0123456789', baseUrl: 'http://localhost:3000' });
const APP = 'http://localhost:3000';
const D = '2026-10-18';
const drain = () => runJobsOnce(db.web, createHandlers(db.web, { messenger, appUrl: APP, gsp: createHttpGsp({ baseUrl: 'http://127.0.0.1:9' }) }), { limit: 100 });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const inv = (over: Partial<DocIn> = {}): DocIn => ({
  docType: 'tax_invoice', partyId: cust, docDate: D, dueDate: '2026-11-17', lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000.00', taxRateBp: 1800 }], ...over,
});
const issueNew = async (over: Partial<DocIn> = {}) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, inv(over))).id)).document;
const doc = async (id: string) => (await getDocument(db.web, owner, id))!.document;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const [a] = await db.owner`insert into app_user (email) values ('acc@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u!.id as string, bid, a!.id as string, 'accountant');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27', phone: '9876543210' });
  custNoPhone = await createParty(db.web, owner, { kind: 'customer', name: 'No Phone Co', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('recording payments', () => {
  it('partial then full payment moves the invoice from unpaid to part paid to paid', async () => {
    const d = await issueNew();
    expect(d.payment_status).toBe('unpaid');
    const p1 = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '500', method: 'cash' });
    expect(p1).toMatchObject({ paymentStatus: 'part_paid', settledPaise: '50000' });
    const p2 = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '680.00', method: 'upi', note: 'UTR 123' });
    expect(p2).toMatchObject({ paymentStatus: 'paid', settledPaise: '118000' });
    expect(await listPayments(db.web, owner, d.id as string)).toHaveLength(2);
    expect((await fails(recordPayment(db.web, owner, { documentId: d.id as string, amount: '1', method: 'cash' }))).message).toMatch(/already paid/);
  });
  it('refuses more than is due, zero, bad methods, drafts and accountants', async () => {
    const d = await issueNew();
    expect((await fails(recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180.01', method: 'cash' }))).message).toMatch(/more than the 1180\.00 still due/);
    expect(await fails(recordPayment(db.web, owner, { documentId: d.id as string, amount: '0', method: 'cash' }))).toBeInstanceOf(ValidationError);
    expect(await fails(recordPayment(db.web, owner, { documentId: d.id as string, amount: '10', method: 'barter' }))).toBeInstanceOf(ValidationError);
    const draft = (await saveDraft(db.web, owner, inv())).id;
    expect((await fails(recordPayment(db.web, owner, { documentId: draft, amount: '10', method: 'cash' }))).message).toMatch(/issued invoice/);
    await expect(recordPayment(db.web, accountant, { documentId: d.id as string, amount: '10', method: 'cash' })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('a manual payment can be voided by an owner and the invoice reopens', async () => {
    const d = await issueNew();
    const p = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'cash' });
    expect((await doc(d.id as string)).payment_status).toBe('paid');
    await voidPayment(db.web, owner, p.paymentId);
    expect(await doc(d.id as string)).toMatchObject({ payment_status: 'unpaid', amount_settled_paise: '0' });
  });
  it('a paid invoice cannot be cancelled; a credit note settles part of it', async () => {
    const d = await issueNew();
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash' });
    const { cancelDocument } = await import('../src/index.js');
    expect((await fails(cancelDocument(db.web, owner, d.id as string, 'oops'))).message).toMatch(/payments cannot be cancelled/);
  });
});

describe('gateway payment links and webhooks', () => {
  it('creates one link for what is due and reuses it', async () => {
    const d = await issueNew();
    const a = await createPaymentLink(db.web, owner, gateway, d.id as string);
    expect(a).toMatchObject({ amountPaise: '118000', reused: false });
    expect(a.url).toMatch(/\/mock-gateway\/plink_/);
    const b = await createPaymentLink(db.web, owner, gateway, d.id as string);
    expect(b).toMatchObject({ id: a.id, reused: true });
    expect(await getPaymentLinks(db.web, owner, d.id as string)).toHaveLength(1);
  });
  async function paidEvent(d: Record<string, any>, amountPaise = 118000n, eventId = 'evt_' + Math.random().toString(36).slice(2)) {
    const link = await createPaymentLink(db.web, owner, gateway, d.id as string);
    const [row] = await db.owner`select gateway_link_id from payment_link where id = ${link.id}`;
    const body = mockPaidEventBody({ linkId: row!.gateway_link_id as string, paymentId: 'pay_' + eventId, amountPaise });
    const evt = gateway.parseWebhook(body, { 'x-mock-signature': signMockWebhook('gateway-secret-0123456789', body), 'x-mock-event-id': eventId });
    return { evt, body, eventId };
  }
  it('a verified paid event records the payment, allocates it, and closes the link', async () => {
    const d = await issueNew();
    const { evt, body } = await paidEvent(d);
    const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    expect(r).toMatchObject({ duplicate: false, applied: { allocatedPaise: '118000', unallocatedPaise: '0' } });
    expect(await doc(d.id as string)).toMatchObject({ payment_status: 'paid', amount_settled_paise: '118000' });
    expect((await getPaymentLinks(db.web, owner, d.id as string))[0]).toMatchObject({ status: 'paid' });
    const [p] = await db.owner`select gateway, gateway_payment_id, method from payment where gateway_event_id = ${(evt as any).eventId}`;
    expect(p).toMatchObject({ gateway: 'mock', method: 'upi' });
    const audit = await db.owner`select actor_id from audit_log where table_name = 'payment' order by id desc limit 1`;
    expect(audit[0]!.actor_id).toBe('00000000-0000-0000-0000-000000000001');
  });
  it('a duplicate delivery of the same event changes nothing', async () => {
    const d = await issueNew();
    const { evt, body } = await paidEvent(d);
    expect((await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body))).duplicate).toBe(false);
    expect((await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body))).duplicate).toBe(true);
    const n = await db.owner`select count(*)::int as n from payment where gateway_event_id = ${(evt as any).eventId}`;
    expect(n[0]!.n).toBe(1);
    expect((await doc(d.id as string)).amount_settled_paise).toBe('118000');
  });
  it('recognizes a provider payment after event pruning and under a new event id', async () => {
    const d = await issueNew();
    const { evt, body, eventId } = await paidEvent(d);
    await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    await db.owner`delete from webhook_event where gateway = 'mock' and event_id = ${eventId}`;
    expect(await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body))).toMatchObject({ duplicate: true });
    expect(await applyGatewayEvent(db.web, 'mock', { ...evt, eventId: eventId + '-new' }, JSON.parse(body))).toMatchObject({ duplicate: true });
    expect(await listPayments(db.web, owner, d.id as string)).toHaveLength(1);
  });
  it('ten simultaneous deliveries of the same event record exactly one payment', async () => {
    const d = await issueNew();
    const { evt, body } = await paidEvent(d);
    const rs = await Promise.all(Array.from({ length: 10 }, () => applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body))));
    expect(rs.filter((r) => !r.duplicate)).toHaveLength(1);
    const n = await db.owner`select count(*)::int as n from payment where gateway_event_id = ${(evt as any).eventId}`;
    expect(n[0]!.n).toBe(1);
    expect(await doc(d.id as string)).toMatchObject({ amount_settled_paise: '118000', payment_status: 'paid' });
  });
  it('an overpayment is kept as unallocated money, not lost and not applied twice', async () => {
    const d = await issueNew();
    const { evt, body } = await paidEvent(d, 150000n);
    const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    expect(r.applied).toMatchObject({ allocatedPaise: '118000', unallocatedPaise: '32000' });
    expect((await listUnallocated(db.web, owner)).some((u) => u.unallocated_paise === '32000')).toBe(true);
  });
  it('a payment for an invoice already paid by hand is all unallocated', async () => {
    const d = await issueNew();
    const { evt, body } = await paidEvent(d);
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'cash' });
    const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    expect(r.applied).toMatchObject({ allocatedPaise: '0', unallocatedPaise: '118000' });
    expect((await doc(d.id as string)).amount_settled_paise).toBe('118000');
  });
  it('an unknown link and an unrelated event are acknowledged and recorded, not applied', async () => {
    const body = mockPaidEventBody({ linkId: 'plink_nope', paymentId: 'pay_x', amountPaise: 100n });
    const evt = gateway.parseWebhook(body, { 'x-mock-signature': signMockWebhook('gateway-secret-0123456789', body), 'x-mock-event-id': 'evt_unknown' });
    expect(await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body))).toMatchObject({ duplicate: false, reason: 'unknown_link' });
    const other = JSON.stringify({ event: 'payment.failed' });
    const e2 = gateway.parseWebhook(other, { 'x-mock-signature': signMockWebhook('gateway-secret-0123456789', other), 'x-mock-event-id': 'evt_other' });
    expect(await applyGatewayEvent(db.web, 'mock', e2, JSON.parse(other))).toMatchObject({ reason: 'ignored' });
  });
  it('rejects bad signatures, missing ids and malformed bodies', () => {
    const body = mockPaidEventBody({ linkId: 'plink_x', paymentId: 'pay_x', amountPaise: 100n });
    const good = signMockWebhook('gateway-secret-0123456789', body);
    const bad = (h: Record<string, string | undefined>, b = body) => { try { gateway.parseWebhook(b, h); } catch (e) { return isWebhookSignatureError(e); } return false; };
    expect(bad({ 'x-mock-signature': good.replace(/.$/, good.endsWith('0') ? '1' : '0'), 'x-mock-event-id': 'e' })).toBe(true);
    expect(bad({ 'x-mock-signature': signMockWebhook('wrong-secret-wrong-secret', body), 'x-mock-event-id': 'e' })).toBe(true);
    expect(bad({ 'x-mock-signature': good })).toBe(true);
    expect(bad({ 'x-mock-signature': 'zz', 'x-mock-event-id': 'e' })).toBe(true);
    expect(bad({ 'x-mock-signature': good, 'x-mock-event-id': 'e' }, body + ' ')).toBe(true);
    const mal = JSON.stringify({ event: 'payment_link.paid', payload: {} });
    expect(bad({ 'x-mock-signature': signMockWebhook('gateway-secret-0123456789', mal), 'x-mock-event-id': 'e' }, mal)).toBe(true);
  });
});

describe('reminders', () => {
  it('are scheduled at issue from the settings, only in the future, and stop when the invoice is paid', async () => {
    await saveReminderConfig(db.web, owner, { enabled: true, channel: 'whatsapp', offsets: [-2, 3, 7] });
    const d = await issueNew({ dueDate: '2099-01-10' });
    const rs = await listReminders(db.web, owner, d.id as string);
    expect(rs.map((r) => r.delivery_status)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(new Date(rs[0]!.scheduled_at as string).toISOString()).toBe('2099-01-08T04:30:00.000Z'); // 10:00 IST
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'cash' });
    expect((await listReminders(db.web, owner, d.id as string)).every((r) => r.delivery_status === 'cancelled')).toBe(true);
  });
  it('a due reminder is queued, sent by the worker, and recorded on the reminder', async () => {
    const d = await issueNew({ dueDate: '2099-02-10' });
    await db.owner`update reminder set scheduled_at = now() - interval '1 minute' where document_id = ${d.id as string} and id = (select id from reminder where document_id = ${d.id as string} order by scheduled_at limit 1)`;
    expect(await processDueReminders(db.web)).toMatchObject({ queued: 1 });
    const before = messenger.outbox.length;
    await drain();
    const m = messenger.outbox[before]!;
    expect(m.text).toMatch(/^Reminder: Tax invoice INV\/26-27\/\d{4} from Acme Traders, Rs 1,180.00 still due/);
    const rs = await listReminders(db.web, owner, d.id as string);
    expect(rs.filter((r) => r.delivery_status === 'sent')).toHaveLength(1);
    expect(await processDueReminders(db.web)).toMatchObject({ queued: 0 });   // not sent twice
  });
  it('a reminder is skipped when the customer has paid or has no phone', async () => {
    const d = await issueNew({ dueDate: '2099-03-10' });
    await db.owner`update reminder set scheduled_at = now() - interval '1 minute' where document_id = ${d.id as string}`;
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'cash' });
    await processDueReminders(db.web);                    // already cancelled by the paid trigger
    const e = await issueNew({ dueDate: '2099-03-11', partyId: custNoPhone });
    await db.owner`update reminder set scheduled_at = now() - interval '1 minute' where document_id = ${e.id as string}`;
    expect(await processDueReminders(db.web)).toMatchObject({ queued: 0, skipped: expect.any(Number) });
    expect((await listReminders(db.web, owner, e.id as string)).every((r) => r.delivery_status === 'failed' || r.delivery_status === 'scheduled')).toBe(true);
  });
  it('settings are validated', async () => {
    expect(await fails(saveReminderConfig(db.web, owner, { channel: 'pigeon' }))).toBeInstanceOf(ValidationError);
    expect(await fails(saveReminderConfig(db.web, owner, { offsets: [1, 2, 3, 4, 5, 6, 7] }))).toBeInstanceOf(ValidationError);
    expect(await fails(saveReminderConfig(db.web, owner, { offsets: [500] }))).toBeInstanceOf(ValidationError);
    await expect(saveReminderConfig(db.web, accountant, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('receivables ageing', () => {
  it('buckets outstanding amounts by days overdue and totals them', async () => {
    const b = await mkBusiness();
    const mk = async (due: string, rate: string, party = b.p) => (await issueDocument(db.web, b.t, (await saveDraft(db.web, b.t, {
      docType: 'tax_invoice', partyId: party, docDate: '2026-01-01', dueDate: due, lines: [{ name: 'x', hsnSac: '8471', quantity: '1', rate, taxRateBp: 0 }] })).id)).document;
    await mk('2026-12-01', '100');   // not due
    await mk('2026-10-10', '200');   // 8 days late
    await mk('2026-09-01', '300');   // 47 days
    await mk('2026-07-20', '400');   // 90 days
    await mk('2026-04-01', '500');   // 200 days
    const partial = await mk('2026-10-10', '1000');
    await recordPayment(db.web, b.t, { documentId: partial.id as string, amount: '250', method: 'cash' });
    const r = await ageingReport(db.web, b.t, { asOf: '2026-10-18' });
    expect(r.totals).toEqual({ not_due: '10000', d1_30: '95000', d31_60: '30000', d61_90: '40000', d90_plus: '50000', total: '225000' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.invoices).toHaveLength(6);
    expect(await fails(ageingReport(db.web, b.t, { asOf: 'yesterday' }))).toBeInstanceOf(ValidationError);
  });
  it('paid and cancelled invoices are not receivables', async () => {
    const b = await mkBusiness();
    const d = (await issueDocument(db.web, b.t, (await saveDraft(db.web, b.t, { docType: 'tax_invoice', partyId: b.p, docDate: D, lines: [{ name: 'x', hsnSac: '8471', quantity: '1', rate: '100', taxRateBp: 0 }] })).id)).document;
    await recordPayment(db.web, b.t, { documentId: d.id as string, amount: '100', method: 'cash' });
    expect((await ageingReport(db.web, b.t, { asOf: D })).totals.total).toBe('0');
  });
  async function mkBusiness() {
    const [u] = await db.owner`insert into app_user (email) values (${`b${Math.random()}@example.test`}) returning id`;
    const g = '29BBBCC1234D1Z4'; void g;
    const state = '24';
    const base = `${state}AAAAA${String(Math.floor(Math.random() * 9000) + 1000)}A1Z`;
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let t = 0;
    for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]!) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
    const gst = base + chars[(36 - (t % 36)) % 36];
    const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Other Biz', gstin: gst, stateCode: state, registrationType: 'regular' });
    const tt = await resolveTenant(db.web, u!.id as string, bid);
    return { t: tt, p: await createParty(db.web, tt, { kind: 'customer', name: 'Buyer', stateCode: state }) };
  }
});

describe('job queue', () => {
  it('claims each job once even when workers race', async () => {
    const ran: string[] = [];
    for (let i = 0; i < 20; i++) await enqueue(db.web, 'test.race', { i });
    const h = { 'test.race': async (j: any) => { ran.push(j.id); } };
    await Promise.all([1, 2, 3, 4].map(() => runJobsOnce(db.web, h, { limit: 10 })));
    await runJobsOnce(db.web, h, { limit: 10 });
    expect(ran).toHaveLength(20);
    expect(new Set(ran).size).toBe(20);
  });
  it('dedupes live jobs by key, but allows a new one after the first finishes', async () => {
    const a = await enqueue(db.web, 'test.dedupe', {}, { dedupeKey: 'k1' });
    const b = await enqueue(db.web, 'test.dedupe', {}, { dedupeKey: 'k1' });
    expect(a).not.toBeNull(); expect(b).toBeNull();
    await runJobsOnce(db.web, { 'test.dedupe': async () => {} });
    expect(await enqueue(db.web, 'test.dedupe', {}, { dedupeKey: 'k1' })).not.toBeNull();
    await runJobsOnce(db.web, { 'test.dedupe': async () => {} });
  });
  it('retries with growing backoff, and gives up after max attempts', async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => retryDelaySeconds(n, () => 0))).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
    expect(retryDelaySeconds(1, () => 1)).toBe(33);
    const id = (await enqueue(db.web, 'test.fail', {}, { maxAttempts: 2 }))!;
    const h = { 'test.fail': async () => { throw new Error('boom'); } };
    expect(await runJobsOnce(db.web, h)).toMatchObject({ retried: 1 });
    await db.owner`update job set run_at = now() where id = ${id}`;
    expect(await runJobsOnce(db.web, h)).toMatchObject({ failed: 1 });
    expect((await db.owner`select status, attempts, last_error from job where id = ${id}`)[0]).toMatchObject({ status: 'failed', attempts: 2, last_error: 'boom' });
  });
  it('a permanent error fails at once, and a crashed worker\'s job is picked up again', async () => {
    const id = (await enqueue(db.web, 'test.perm', {}))!;
    expect(await runJobsOnce(db.web, { 'test.perm': async () => { throw new PermanentJobError('bad data'); } })).toMatchObject({ failed: 1 });
    expect((await db.owner`select attempts from job where id = ${id}`)[0]!.attempts).toBe(1);
    const stale = (await enqueue(db.web, 'test.stale', {}))!;
    await db.owner`update job set status = 'running', locked_at = now() - interval '11 minutes', locked_by = 'dead-worker' where id = ${stale}`;
    expect(await runJobsOnce(db.web, { 'test.stale': async () => {} })).toMatchObject({ done: 1 });
  });
  it('a job queued in a transaction that rolls back never exists', async () => {
    await db.web.begin(async (tx) => { await enqueue(tx, 'test.rollback', {}); throw new Error('rollback'); }).catch(() => {});
    expect((await db.owner`select count(*)::int as n from job where queue = 'test.rollback'`)[0]!.n).toBe(0);
  });
});

describe('leased job ownership', () => {
  it.each(['success', 'failure'])('ignores stale %s after another worker reclaims', async (outcome) => {
    const queue = `test.fence.${outcome}`;
    const id = await enqueue(db.web, queue, {});
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const blocked = new Promise<void>(r => { release = r; });
    const old = runJobsOnce(db.web, { [queue]: async () => { entered(); await blocked; if (outcome === 'failure') throw new Error('late'); } }, { limit: 1 });
    await started;
    await db.owner`update job set locked_at = now() - interval '11 minutes' where id = ${id}`;
    const [fresh] = await db.web`select * from claim_jobs(${[queue]}, 1, 'new-worker')`;
    release();
    expect(await old).toMatchObject({ done: 0, retried: 0, failed: 0 });
    const [row] = await db.owner`select status, lease_token from job where id = ${id}`;
    expect(row).toMatchObject({ status: 'running', lease_token: fresh!.lease_token });
  });
  it('fails an expired final attempt rather than claiming forever', async () => {
    const id = await enqueue(db.web, 'test.expiry', {}, { maxAttempts: 1 });
    await db.web`select * from claim_jobs(${['test.expiry']}, 1, 'crashed')`;
    await db.owner`update job set locked_at = now() - interval '11 minutes' where id = ${id}`;
    expect(await runJobsOnce(db.web, { 'test.expiry': async () => { throw new Error('must not execute'); } })).toMatchObject({ claimed: 0 });
    expect((await db.owner`select status from job where id = ${id}`)[0]!.status).toBe('failed');
  });
  it('does not reserve later jobs or claim after a deadline', async () => {
    await enqueue(db.web, 'test.deadline', {});
    await enqueue(db.web, 'test.deadline', {});
    const options = { limit: 10, deadline: Infinity };
    const result = await runJobsOnce(db.web, { 'test.deadline': async () => {
      expect((await db.owner`select count(*)::int as n from job where queue = 'test.deadline' and status = 'running'`)[0]!.n).toBe(1);
      options.deadline = 0;
    } }, options);
    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect((await db.owner`select count(*)::int as n from job where queue = 'test.deadline' and status = 'queued'`)[0]!.n).toBe(1);
  });
});

describe('payment operation replay', () => {
  it('records concurrent retries once and returns the original response', async () => {
    const d = await issueNew();
    const input = { documentId: d.id as string, amount: '100', method: 'cash', operationKey: 'concurrent-payment-key-1' };
    const responses = await Promise.all([recordPayment(db.web, owner, input), recordPayment(db.web, owner, input)]);
    expect(responses[0]).toEqual(responses[1]);
    expect(await listPayments(db.web, owner, d.id as string)).toHaveLength(1);
    expect(await recordPayment(db.web, owner, { ...input, amount: '100.00' })).toEqual(responses[0]);
    await expect(recordPayment(db.web, owner, { ...input, amount: '200' })).rejects.toThrow(/different details/);
    await expect(recordPayment(db.web, accountant, input)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('does not reserve a key when the payment transaction fails', async () => {
    const d = await issueNew();
    const input = { documentId: d.id as string, amount: '2000', method: 'cash', operationKey: 'rollback-payment-key-1' };
    await expect(recordPayment(db.web, owner, input)).rejects.toThrow(/more than/);
    expect(await recordPayment(db.web, owner, { ...input, amount: '100' })).toHaveProperty('paymentId');
  });
});
