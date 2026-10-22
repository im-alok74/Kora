import { portalDocumentLink } from '@kora/core';
import { errorResponse, services } from '../../../../../lib/server';
import { portalGate } from '../../../../../lib/portal';

/** Opens the page for one of the customer's documents (with its PDF button), through a short-lived public link. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const link = await portalDocumentLink(services().sql, token, id);
    if (!link) return new Response('Not found', { status: 404 });
    return Response.redirect(new URL(`/i/${link.token}`, req.url), 302);
  } catch (e) { return errorResponse(e); }
}
