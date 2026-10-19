import { json, requireJson, services, errorResponse, requestInfo, sessionCookie } from '../../../../lib/server';

/** The second step of signing in: { mfaToken, code } where code is from the authenticator app, or one recovery code. */
export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { mfaToken, code } = (await req.json()) as { mfaToken?: string; code?: string };
    const s = await services().auth.completeMfa(String(mfaToken ?? ''), String(code ?? ''), requestInfo(req));
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(s.token) });
  } catch (e) {
    return errorResponse(e);
  }
}
