import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingEventBody, createMockBilling, signBillingWebhook, WebhookSignatureError } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { applyBillingEvent, billingSummary, cancelPlan, createBusiness, getPlan, resolveTenant, startCheckout, type TenantSession } from '../src/index.js';

const SECRET = 'billing-secret-billing-secret-12';
const gw = createMockBilling({ secret: SECRET, baseUrl: 'http://localhost:3000' });
let db: TestDb;
let t: TenantSession;
let subId = '';

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('bill@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  t = await resolveTenant(db.web, u!.id as string, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

const event = (type: string, extra: { periodEnd?: Date; paymentId?: string; amountPaise?: bigint } = {}, id = `evt_${Math.random().toString(36).slice(2)}`) => {
  const raw = billingEventBody({ type, subscriptionId: subId, ...extra });
  const evt = gw.parseWebhook(raw, { 'x-mock-signature': signBillingWebhook(SECRET, raw), 'x-mock-event-id': id });
  return { evt, id };
};
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('buying a plan', () => {
  it('refuses a plan with no gateway id and an unknown plan', async () => {
    await expect(startCheckout(db.web, t, gw, {}, 'business')).rejects.toThrow(/cannot be bought online yet/);
    await expect(startCheckout(db.web, t, gw, { business: 'plan_x' }, 'starter')).rejects.toThrow(/Choose the Business/);
  });
  it('starts a subscription and stays on the free plan until the first payment', async () => {
    const r = await startCheckout(db.web, t, gw, { business: 'plan_b', firm: 'plan_f' }, 'business');
    expect(r.url).toMatch(/mock_subscription=sub_/);
    subId = new URL(r.url).searchParams.get('mock_subscription')!;
    expect((await getPlan(db.web, t)).plan.id).toBe('starter');
  });
});

describe('webhooks', () => {
  it('rejects a body with a wrong signature', () => {
    const raw = billingEventBody({ type: 'subscription.charged', subscriptionId: subId });
    expect(() => gw.parseWebhook(raw, { 'x-mock-signature': 'ab'.repeat(32), 'x-mock-event-id': 'e1' })).toThrow(WebhookSignatureError);
  });
  it('activation moves the business to the paid plan with the paid period', async () => {
    const end = inDays(30);
    const { evt } = event('subscription.charged', { periodEnd: end, paymentId: 'pay_1', amountPaise: 49_900n });
    expect((await applyBillingEvent(db.web, 'mock', evt)).result).toBe('applied');
    const ep = await getPlan(db.web, t);
    expect(ep.plan.id).toBe('business');
    expect(ep.status).toBe('active');
    const s = await billingSummary(db.web, t);
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]!.amount_paise).toBe('49900');
  });
  it('a repeated event changes nothing, and a repeated payment is booked once', async () => {
    const { evt, id } = event('subscription.charged', { periodEnd: inDays(60), paymentId: 'pay_2', amountPaise: 49_900n });
    expect((await applyBillingEvent(db.web, 'mock', evt)).result).toBe('applied');
    expect((await applyBillingEvent(db.web, 'mock', evt)).result).toBe('duplicate');
    const other = event('subscription.charged', { periodEnd: inDays(60), paymentId: 'pay_2', amountPaise: 49_900n }, `${id}_again`);
    await applyBillingEvent(db.web, 'mock', other.evt);
    expect((await billingSummary(db.web, t)).payments).toHaveLength(2);
  });
  it('a failed renewal marks it past due and keeps the plan for the grace days', async () => {
    await applyBillingEvent(db.web, 'mock', event('subscription.halted').evt);
    const ep = await getPlan(db.web, t);
    expect(ep.status).toBe('past_due');
    expect(ep.plan.id).toBe('business');
  });
  it('an event for a subscription Kora never made is not applied', async () => {
    const raw = billingEventBody({ type: 'subscription.charged', subscriptionId: 'sub_unknown', paymentId: 'pay_x', amountPaise: 100n, periodEnd: inDays(1) });
    const evt = gw.parseWebhook(raw, { 'x-mock-signature': signBillingWebhook(SECRET, raw), 'x-mock-event-id': 'e_unknown' });
    expect((await applyBillingEvent(db.web, 'mock', evt)).result).toBe('unknown_subscription');
  });
  it('cancelling keeps the plan to the end of the paid period, then drops to free', async () => {
    await applyBillingEvent(db.web, 'mock', event('subscription.charged', { periodEnd: inDays(20), paymentId: 'pay_3', amountPaise: 49_900n }).evt);
    await cancelPlan(db.web, t, gw);
    await applyBillingEvent(db.web, 'mock', event('subscription.cancelled', { periodEnd: inDays(20) }).evt);
    expect((await getPlan(db.web, t)).plan.id).toBe('business');
    await applyBillingEvent(db.web, 'mock', event('subscription.cancelled', { periodEnd: inDays(-1) }).evt);
    expect((await getPlan(db.web, t)).plan.id).toBe('starter');
  });
  it('tenants cannot write billing tables directly', async () => {
    await expect(db.web`insert into billing_payment (business_id, subscription_id, gateway_payment_id, amount_paise) values (${t.businessId}, gen_random_uuid(), 'p', 1)`).rejects.toThrow();
    await expect(db.web`select * from billing_event`).rejects.toThrow();
  });
});
