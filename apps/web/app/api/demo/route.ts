import { cookies } from 'next/headers';
import { createDemoBusiness, isDemoBusiness } from '@kora/core';
import { BUSINESS_COOKIE, currentUserId, errorResponse, json, requireJson, services } from '../../../lib/server';

/** GET: is the business you are working in a demo? POST: make (or find) your demo business and switch to it. */
export async function GET() {
  try {
    const userId = await currentUserId();
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const id = (await cookies()).get(BUSINESS_COOKIE)?.value;
    return json({ isDemo: id ? await isDemoBusiness(services().sql, id) : false });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const userId = await currentUserId();
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const { businessId, created } = await createDemoBusiness(services().sql, userId);
    (await cookies()).set(BUSINESS_COOKIE, businessId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production' });
    return json({ businessId, created }, created ? 201 : 200);
  } catch (e) { return errorResponse(e); }
}
