import { json, requireJson, services, errorResponse, requestInfo, sessionCookie } from '../../../../lib/server';

/** Body: { identifier, password }. A second step follows for accounts with an authenticator app (POST /api/auth/mfa). */
export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { identifier, password } = (await req.json()) as { identifier?: string; password?: string };
    const s = await services().auth.signInPassword(String(identifier ?? ''), String(password ?? ''), requestInfo(req));
    if (s.needsMfa) return json({ ok: true, needsMfa: true, mfaToken: s.mfaToken });
    return json({ ok: true, isNewUser: s.isNewUser }, 200, { 'set-cookie': sessionCookie(s.token) });
  } catch (e) {
    return errorResponse(e);
  }
}
