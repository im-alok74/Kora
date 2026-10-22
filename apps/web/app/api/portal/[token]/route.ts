import { portalOverview } from '@kora/core';
import { errorResponse, json, services } from '../../../../lib/server';
import { portalGate } from '../../../../lib/portal';

/** Public, no sign-in. The token in the URL is the only credential, and it opens one customer's portal. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const o = await portalOverview(services().sql, token);
    return o ? json(o, 200, { 'x-robots-tag': 'noindex' }) : json({ error: 'This link is not valid any more. Ask the business for a new one.' }, 404);
  } catch (e) { return errorResponse(e); }
}
