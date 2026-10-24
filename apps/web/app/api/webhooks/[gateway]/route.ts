import { applyGatewayEvent, log } from '@kora/core';
import { isWebhookSignatureError } from '@kora/adapters';
import { json, services } from '../../../../lib/server';

export const runtime = 'nodejs';

/**
 * Gateway webhooks. The signature is checked against the raw body before anything is parsed or stored.
 * 200 means "got it" (including duplicates); any failure to apply returns 500 so the gateway retries.
 */
export async function POST(req: Request, ctx: { params: Promise<{ gateway: string }> }) {
  const { gateway: name } = await ctx.params;
  const svc = services();
  if (name !== svc.gateway.name) return json({ error: 'Unknown gateway.' }, 404);
  const raw = await req.text();
  if (raw.length > 100_000) return json({ error: 'Body too large.' }, 413);
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let evt;
  try { evt = svc.gateway.parseWebhook(raw, headers); }
  catch (e) {
    if (isWebhookSignatureError(e)) return json({ error: 'Invalid signature.' }, 400);
    throw e;
  }
  try {
    const r = await applyGatewayEvent(svc.sql, name, evt, JSON.parse(raw));
    // Money the books could not place. The event is kept in webhook_event (processed, payload intact), but nobody sees it unless a log
    // alert watches for this name: a payment for a link Kora has no row for, or one made in a currency other than rupees.
    if (r.reason === 'unknown_link' || (evt.kind === 'ignored' && /^payment_link\.paid_in_/.test(evt.type))) {
      log('error', 'payment_unmatched', { gateway: name, eventId: evt.eventId, reason: r.reason === 'unknown_link' ? 'unknown_link' : evt.kind === 'ignored' ? evt.type : undefined });
    }
    return json({ ok: true, duplicate: r.duplicate });
  } catch (e) {
    console.error('webhook failed', e);
    return json({ error: 'Could not apply the event.' }, 500);
  }
}
