import { json, requireJson, services, errorResponse, requestInfo, sessionCookie } from '../../../../lib/server';

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { identifier, code } = (await req.json()) as { identifier?: string; code?: string };
    const s = await services().auth.verifyOtpStep(String(identifier ?? ''), String(code ?? ''), requestInfo(req));
    if (s.needsMfa) return json({ ok: true, needsMfa: true, mfaToken: s.mfaToken });
    return json({ ok: true, isNewUser: s.isNewUser }, 200, { 'set-cookie': sessionCookie(s.token) });
  } catch (e) {
    return errorResponse(e);
  }
}
