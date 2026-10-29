import { applyBillingEvent, log } from '@kora/core';
import { isWebhookSignatureError } from '@kora/adapters';
import { billing, json, services } from '../../../../lib/server';

export const runtime = 'nodejs';

/**
 * Razorpay Subscriptions events for Kora's own plans. The signature is checked on the raw body first. 200 means received (also for a
 * repeat); a failure to apply returns 500 so Razorpay sends it again.
 */
export async function POST(req: Request) {
  const b = billing();
  if (!b) return json({ error: 'Billing is not set up.' }, 404);
  const raw = await req.text();
  if (raw.length > 100_000) return json({ error: 'Body too large.' }, 413);
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let evt;
  try { evt = b.gw.parseWebhook(raw, headers); }
  catch (e) {
    if (isWebhookSignatureError(e)) return json({ error: 'Invalid signature.' }, 400);
    throw e;
  }
  try {
    const r = await applyBillingEvent(services().sql, b.gw.name, evt);
    // An event for a subscription Kora has no row for is worth a look: a payment that nothing explains.
    if (r.result === 'unknown_subscription') log('error', 'billing_unmatched', { eventId: evt.eventId, type: evt.kind === 'subscription' ? evt.type : evt.type });
    return json({ ok: true, result: r.result });
  } catch (e) {
    console.error('billing webhook failed', e);
    return json({ error: 'Could not apply the event.' }, 500);
  }
}
