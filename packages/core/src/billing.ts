import type { BillingEvent, BillingGateway } from '@kora/adapters';
import type { Sql } from '@kora/db';
import { PLANS, effectivePlanTx, type PlanId } from './plans.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/** Razorpay plan ids by Kora plan, from the environment. A plan with no id cannot be bought yet. */
export type GatewayPlanIds = Partial<Record<'business' | 'firm', string>>;

/** Billing cycles to authorise. Razorpay needs a number; 120 monthly cycles is ten years, effectively until cancelled. */
const TOTAL_COUNT = 120;

/** Starts a purchase: makes the subscription at the gateway and records it. Returns the address where the owner authorises the payment. */
export async function startCheckout(sql: Sql, t: TenantSession, gw: BillingGateway, planIds: GatewayPlanIds, plan: string): Promise<{ url: string }> {
  if (plan !== 'business' && plan !== 'firm') throw new ValidationError('Choose the Business or the Firm plan.', 'plan');
  const gatewayPlanId = planIds[plan];
  if (!gatewayPlanId) throw new ValidationError('This plan cannot be bought online yet. Please write to us.', 'plan');
  const cur = await inTenant(sql, t, 'billing.manage', async (tx) => {
    const ep = await effectivePlanTx(tx, t.businessId);
    const [open] = await tx`select gateway_subscription_id from subscription where status in ('active', 'past_due') and cancel_at_period_end = false limit 1`;
    return { ep, open };
  });
  if (cur.open && cur.ep.plan.id !== 'starter') throw new ValidationError('You already have a plan. Cancel it first, or write to us to change it.');
  const sub = await gw.createSubscription({ gatewayPlanId, totalCount: TOTAL_COUNT, notes: { businessId: t.businessId, plan } });
  await inTenant(sql, t, 'billing.manage', (tx) => tx`select billing_start(${t.businessId}, ${plan}, ${gw.name}, ${sub.id})`);
  return { url: sub.url };
}

/** Stops renewing at the end of the paid period. The plan stays until then. */
export async function cancelPlan(sql: Sql, t: TenantSession, gw: BillingGateway): Promise<void> {
  const [s] = await inTenant(sql, t, 'billing.manage', (tx) => tx`select gateway_subscription_id as id from subscription
                                                                  where status in ('active', 'past_due') and gateway = ${gw.name} order by created_at desc limit 1`);
  if (!s) throw new ValidationError('There is no paid plan to cancel.');
  await gw.cancelSubscription(s.id as string, true);
  await inTenant(sql, t, 'billing.manage', (tx) => tx`select billing_set_cancel(${t.businessId}, ${s.id as string}, true)`);
}

/** A verified webhook event. Idempotent: the database refuses a second copy. */
export async function applyBillingEvent(sql: Sql, gatewayName: string, evt: BillingEvent): Promise<{ result: string }> {
  if (evt.kind === 'ignored') {
    await sql`insert into billing_event (gateway, event_id, type) values (${gatewayName}, ${evt.eventId}, ${evt.type.slice(0, 80)}) on conflict do nothing`.catch(() => undefined);
    return { result: 'ignored' };
  }
  const [r] = await sql`select billing_apply_event(${gatewayName}, ${evt.eventId}, ${evt.type}, ${evt.subscriptionId}, ${evt.periodEnd}::timestamptz,
                                                   ${evt.paymentId}, ${evt.amountPaise === null ? null : evt.amountPaise.toString()}::bigint) as result`;
  return { result: r!.result as string };
}

/** The Billing page: plan, current subscription and the payments made. */
export async function billingSummary(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'billing.manage', async (tx) => {
    const ep = await effectivePlanTx(tx, t.businessId);
    const [sub] = await tx`select plan, status, current_period_end::text as current_period_end, cancel_at_period_end from subscription order by created_at desc limit 1`;
    const payments = await tx`select gateway_payment_id as id, amount_paise::text as amount_paise, period_end::text as period_end, paid_at::text as paid_at from billing_payment order by paid_at desc limit 24`;
    return { plan: ep.plan.id, planName: ep.plan.name, status: ep.status, validUntil: ep.validUntil, subscription: sub ?? null, payments,
             plans: (Object.keys(PLANS) as PlanId[]).map((id) => ({ id, name: PLANS[id].name, pricePaise: PLANS[id].pricePaise })) };
  });
}
