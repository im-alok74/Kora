import { portalAnswerEstimate, ValidationError } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../../lib/server';

/** Body: { action: 'accept' | 'decline' }. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token, id } = await ctx.params;
    const action = String((await readJson(req)).action ?? '');
    if (action !== 'accept' && action !== 'decline') throw new ValidationError('Choose accept or decline.', 'action');
    const r = await portalAnswerEstimate(services().sql, token, id, action === 'accept' ? 'accepted' : 'declined');
    return r ? json(r) : json({ error: 'This link is not valid any more. Ask the business for a new one.' }, 404);
  } catch (e) { return errorResponse(e); }
}
