import { portalVerifyCode } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../lib/server';
import { PORTAL_GONE, portalCookie, portalSecret } from '../../../../../lib/portal';

/** Body: { code }. On success the answer sets a cookie that opens this one portal for a few hours. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token } = await ctx.params;
    const r = await portalVerifyCode(services().sql, portalSecret(), token, String((await readJson(req)).code ?? ''));
    if (!r) return json(PORTAL_GONE, 404);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return json({ ok: true }, 200, { 'set-cookie': `${portalCookie(token)}=${r.session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${r.hours * 3600}${secure}` });
  } catch (e) { return errorResponse(e); }
}
