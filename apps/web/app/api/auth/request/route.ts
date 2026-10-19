import { json, requireJson, services, errorResponse, requestInfo } from '../../../../lib/server';

export async function POST(req: Request) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { identifier } = (await req.json()) as { identifier?: string };
    await services().auth.requestOtp(String(identifier ?? ''), requestInfo(req));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
