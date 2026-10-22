import { cookies } from 'next/headers';
import { removeDemoBusiness } from '@kora/core';
import { BUSINESS_COOKIE, currentUserId, errorResponse, json, requireJson, services } from '../../../../lib/server';

/** Removes the demo business you are working in. It refuses a real business. */
export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const userId = await currentUserId();
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const jar = await cookies();
    const id = jar.get(BUSINESS_COOKIE)?.value;
    if (!id || !(await removeDemoBusiness(services().sql, userId, id))) return json({ error: 'Only a sample business that you own can be removed.' }, 400);
    jar.delete(BUSINESS_COOKIE);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
