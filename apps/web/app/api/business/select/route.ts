import { cookies } from 'next/headers';
import { resolveTenant } from '@kora/core';
import { BUSINESS_COOKIE, currentUserId, errorResponse, isUuid, json, readJson, requireJson, services } from '../../../../lib/server';

/** Chooses the active business. Membership is checked here and again on every request. */
export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const userId = await currentUserId();
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const { businessId } = await readJson<{ businessId?: string }>(req);
    if (!businessId || !isUuid(businessId)) return json({ error: 'Choose a business.' }, 400);
    await resolveTenant(services().sql, userId, businessId);
    (await cookies()).set(BUSINESS_COOKIE, businessId, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production',
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
