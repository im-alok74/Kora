import { json, requireJson, services, errorResponse, requestInfo, sessionCookie } from '../../../../lib/server';

/** Body: { identifier, password, name, accountType }. Makes the account and signs in. No code is sent. */
export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const b = (await req.json()) as { identifier?: string; password?: string; name?: string; accountType?: string };
    const s = await services().auth.signUp({ identifier: String(b.identifier ?? ''), password: String(b.password ?? ''), name: String(b.name ?? ''), accountType: b.accountType }, requestInfo(req));
    if (s.needsMfa) return json({ ok: true, needsMfa: true, mfaToken: s.mfaToken });
    return json({ ok: true, isNewUser: true }, 200, { 'set-cookie': sessionCookie(s.token) });
  } catch (e) {
    return errorResponse(e);
  }
}
