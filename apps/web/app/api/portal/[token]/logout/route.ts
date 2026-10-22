import { cookies } from 'next/headers';
import { portalSignOut } from '@kora/core';
import { errorResponse, json, services } from '../../../../../lib/server';
import { portalCookie } from '../../../../../lib/portal';

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    await portalSignOut(services().sql, token, (await cookies()).get(portalCookie(token))?.value);
    return json({ ok: true }, 200, { 'set-cookie': `${portalCookie(token)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  } catch (e) { return errorResponse(e); }
}
