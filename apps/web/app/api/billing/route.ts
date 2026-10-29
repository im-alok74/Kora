import { applyBillingEvent, billingSummary, cancelPlan, startCheckout, usageSummary } from '@kora/core';
import { billingEventBody, signBillingWebhook } from '@kora/adapters';
import { billing, json, services, tenantRoute } from '../../../lib/server';

/**
 *   GET                              the plan, what is used, the subscription and payments made, and whether plans can be bought online
 *   POST { action: 'checkout', plan: 'business' | 'firm' }   { url } where the owner authorises the payment
 *   POST { action: 'cancel' }        stop renewing at the end of the paid period
 */
export const GET = tenantRoute(async ({ t, sql }) => {
  const [summary, usage] = await Promise.all([billingSummary(sql, t), usageSummary(sql, t)]);
  return { ...summary, usage: usage.usage, enforced: usage.enforced, canBuy: billing() !== null };
});

export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = billing();
  if (!b) return json({ error: 'Plans cannot be bought online yet. Please write to us.' }, 503);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action === 'checkout') return startCheckout(sql, t, b.gw, b.planIds, String(body.plan ?? ''));
  if (body.action === 'cancel') { await cancelPlan(sql, t, b.gw); return { ok: true }; }
  // Development only: pretend the owner paid at the mock checkout, by sending the same signed event Razorpay would.
  if (body.action === 'mock.pay' && b.gw.name === 'mock' && process.env.NODE_ENV !== 'production') {
    const sub = String(body.subscription ?? '');
    const raw = billingEventBody({ type: 'subscription.charged', subscriptionId: sub, periodEnd: new Date(Date.now() + 30 * 86_400_000), paymentId: `pay_mock_${Date.now()}`, amountPaise: 49_900n });
    const evt = b.gw.parseWebhook(raw, { 'x-mock-signature': signBillingWebhook(process.env.BILLING_WEBHOOK_SECRET ?? '', raw), 'x-mock-event-id': `evt_mock_${Date.now()}` });
    return applyBillingEvent(services().sql, b.gw.name, evt);
  }
  return json({ error: 'Unknown action.' }, 400);
});
