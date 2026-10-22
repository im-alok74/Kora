import { portalBulkPaymentLink } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../lib/server';
import { PORTAL_GONE, portalGate } from '../../../../../lib/portal';

/** Body: { ids: [invoice ids] }. One hosted payment for all of them; the money is spread over the invoices when it arrives. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const ids = (await readJson(req)).ids;
    const s = services();
    const r = await portalBulkPaymentLink(s.sql, token, s.gateway, Array.isArray(ids) ? ids.map(String) : []);
    return r ? json(r) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}
