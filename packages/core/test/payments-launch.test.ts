import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockGateway, createRazorpayGateway, mockPaidEventBody, signMockWebhook, signRazorpayWebhook } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  applyGatewayEvent, createBusiness, createParty, createPaymentLink, getDocument, issueDocument, resolveTenant, saveDraft, writeOffInvoice,
  type DocIn, type TenantSession,
} from '../src/index.js';

// Findings P-1, P-3 and P-4 of the launch audit (kora-audit/launch/payments.md): what a real Razorpay payment can do to the books.

let db: TestDb;
let owner: TenantSession;
let cust: string;
const SECRET = 'gateway-secret-0123456789';
const gateway = createMockGateway({ secret: SECRET, baseUrl: 'http://localhost:3000' });
const inv = (): DocIn => ({ docType: 'tax_invoice', partyId: cust, docDate: '2026-10-18', dueDate: '2026-11-17', lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000.00', taxRateBp: 1800 }] });
const issueNew = async () => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, inv())).id)).document;
const doc = async (id: string) => (await getDocument(db.web, owner, id))!.document;

async function paid(d: Record<string, any>, method: string, eventId = 'evt_' + Math.random().toString(36).slice(2)) {
  const link = await createPaymentLink(db.web, owner, gateway, d.id as string);
  const [row] = await db.owner`select gateway_link_id from payment_link where id = ${link.id}`;
  const body = mockPaidEventBody({ linkId: row!.gateway_link_id as string, paymentId: 'pay_' + eventId, amountPaise: 118000n, method });
  const evt = gateway.parseWebhook(body, { 'x-mock-signature': signMockWebhook(SECRET, body), 'x-mock-event-id': eventId });
  return { evt, body, eventId };
}

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27', phone: '9876543210' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('P-1: every way a customer can pay is recorded', () => {
  // Razorpay reports method as card, netbanking, wallet, upi, emi, paylater, bank_transfer ... The payment table accepts a shorter list.
  for (const method of ['wallet', 'emi', 'paylater', 'cardless_emi', 'something_new']) {
    it(`a ${method} payment marks the invoice paid and is stored as a method the books accept`, async () => {
      const d = await issueNew();
      const { evt, body } = await paid(d, method);
      const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
      expect(r.applied).toMatchObject({ allocatedPaise: '118000' });
      expect(await doc(d.id as string)).toMatchObject({ payment_status: 'paid' });
      const [p] = await db.owner`select method from payment where gateway_payment_id = ${'pay_' + (evt as any).eventId}`;
      expect(['upi', 'card', 'netbanking', 'bank_transfer', 'other']).toContain(p!.method);
    });
  }
});

describe('P-5: a payment link expires, so an old one cannot be paid months after the invoice is settled', () => {
  it('asks the gateway for an expiry, and does not reuse a link that is about to expire', async () => {
    const asked: (Date | undefined)[] = [];
    const spy = { ...gateway, async createPaymentLink(req: Parameters<typeof gateway.createPaymentLink>[0]) { asked.push(req.expiresAt); return gateway.createPaymentLink(req); } };
    const d = await issueNew();
    const a = await createPaymentLink(db.web, owner, spy, d.id as string);
    expect(asked[0]).toBeInstanceOf(Date);
    const days = (asked[0]!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(85); expect(days).toBeLessThan(95);
    expect(await createPaymentLink(db.web, owner, spy, d.id as string)).toMatchObject({ id: a.id, reused: true });
    await db.owner`update payment_link set created_at = now() - interval '85 days' where id = ${a.id}`;
    const b = await createPaymentLink(db.web, owner, spy, d.id as string);
    expect(b.reused).toBe(false);
    expect(b.id).not.toBe(a.id);
  });
});

describe('P-3: money that arrives through the gateway for a written-off invoice', () => {
  it('takes the write-off back in the same step, so the bad debt and the receipt are not both on the books', async () => {
    const d = await issueNew();
    const { evt, body } = await paid(d, 'upi');
    await writeOffInvoice(db.web, owner, d.id as string, 'Customer disappeared');
    const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    expect(r.applied).toMatchObject({ allocatedPaise: '118000' });
    expect(await doc(d.id as string)).toMatchObject({ payment_status: 'paid' });
    const live = await db.owner`select id from document_write_off where document_id = ${d.id as string} and cancelled_at is null`;
    expect(live).toHaveLength(0);
    const [w] = await db.owner`select cancel_reason from document_write_off where document_id = ${d.id as string}`;
    expect(String(w!.cancel_reason)).toMatch(/paid/i);
  });
});

describe('P-4: Razorpay events in another currency are not booked as rupees', () => {
  const cfg = { keyId: 'rzp_test_1', keySecret: 'secret', webhookSecret: 'whsec_12345678' };
  const g = createRazorpayGateway(cfg);
  const event = (currency?: string) => JSON.stringify({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: 'plink_x', amount: 118000, ...(currency ? { currency } : {}) } }, payment: { entity: { id: 'pay_x', amount: 118000, method: 'upi', ...(currency ? { currency } : {}) } } },
  });
  const parse = (body: string) => g.parseWebhook(body, { 'x-razorpay-signature': signRazorpayWebhook(cfg.webhookSecret, body), 'x-razorpay-event-id': 'evt_c' });
  it('keeps a USD payment in the inbox without booking it', () => {
    expect(parse(event('USD'))).toEqual({ kind: 'ignored', eventId: 'evt_c', type: 'payment_link.paid_in_USD' });
  });
  it('stores wallet, emi and any method the books do not list as other', () => {
    for (const m of ['wallet', 'emi', 'paylater', 'cardless_emi']) {
      const body = mockPaidEventBody({ linkId: 'plink_x', paymentId: 'pay_x', amountPaise: 100n, method: m });
      expect(parse(body)).toMatchObject({ method: 'other' });
    }
    for (const m of ['upi', 'card', 'netbanking', 'bank_transfer']) expect(parse(mockPaidEventBody({ linkId: 'plink_x', paymentId: 'pay_x', amountPaise: 100n, method: m }))).toMatchObject({ method: m });
  });
  it('accepts INR, and an event that carries no currency at all', () => {
    expect(parse(event('INR'))).toMatchObject({ kind: 'payment_link.paid', amountPaise: 118000n });
    expect(parse(event())).toMatchObject({ kind: 'payment_link.paid' });
  });
});
