import { json, requireJson, services, errorResponse, SESSION_COOKIE } from '../../../../lib/server';

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { identifier, code } = (await req.json()) as { identifier?: string; code?: string };
    const s = await services().auth.verifyOtp(String(identifier ?? ''), String(code ?? ''));
    const days = Number(process.env.SESSION_TTL_DAYS ?? 30);
    const cookie = [
      `${SESSION_COOKIE}=${s.token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${days * 86400}`,
      process.env.NODE_ENV === 'production' ? 'Secure' : '',
    ].filter(Boolean).join('; ');
    return json({ ok: true, isNewUser: s.isNewUser }, 200, { 'set-cookie': cookie });
  } catch (e) {
    return errorResponse(e);
  }
}
