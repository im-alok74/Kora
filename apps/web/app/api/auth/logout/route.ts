import { cookies } from 'next/headers';
import { json, requireJson, services, SESSION_COOKIE } from '../../../../lib/server';

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await services().auth.revokeSession(token);
  return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
}
