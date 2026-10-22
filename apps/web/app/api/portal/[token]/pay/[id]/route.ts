import { portalPaymentLink } from '@kora/core';
import { errorResponse, json, requireJson, services } from '../../../../../../lib/server';
import { portalGate } from '../../../../../../lib/portal';

/** Returns the hosted payment page for what is still due on this customer's invoice. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token, id } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const s = services();
    const r = await portalPaymentLink(s.sql, token, s.gateway, id);
    return r ? json(r) : json({ error: 'This link is not valid any more. Ask the business for a new one.' }, 404);
  } catch (e) { return errorResponse(e); }
}
