import { portalAddComment, portalComments } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../../lib/server';
import { PORTAL_GONE, portalGate } from '../../../../../../lib/portal';

/** Comments on one document and the files the customer has attached to it. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const r = await portalComments(services().sql, token, id);
    return r ? json(r) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}

/** Body: { body }. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token, id } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const r = await portalAddComment(services().sql, token, id, String((await readJson(req)).body ?? ''));
    return r ? json(r) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}
