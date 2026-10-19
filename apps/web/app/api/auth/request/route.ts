import { json, requireJson, services, errorResponse } from '../../../../lib/server';

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { identifier } = (await req.json()) as { identifier?: string };
    await services().auth.requestOtp(String(identifier ?? ''));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
