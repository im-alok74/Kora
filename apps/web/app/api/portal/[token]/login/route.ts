import { portalLoginInfo, portalSendCode } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../lib/server';
import { PORTAL_GONE, portalFixedCode, portalSecret, portalSender } from '../../../../../lib/portal';

/** Does this link ask for a code, and where could one go (masked)? */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const i = await portalLoginInfo(services().sql, token);
    return i ? json(i, 200, { 'x-robots-tag': 'noindex' }) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}

/** Body: { channel?: 'sms' | 'email' }. Sends a code to the address on the record of the customer. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token } = await ctx.params;
    const c = (await readJson(req)).channel;
    const r = await portalSendCode(services().sql, portalSender(), portalSecret(), token, c === 'sms' || c === 'email' ? c : undefined, { fixedCode: portalFixedCode() });
    return r ? json(r) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}
