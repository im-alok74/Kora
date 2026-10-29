import { loadUploadPage, uploadViaLink } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../lib/server';
import { publicLimit } from '../../../../../lib/publicLimit';

const GONE = { error: 'This link is not valid any more. Ask the firm for a new one.' };
type Ctx = { params: Promise<{ token: string }> };

/** Public, no sign-in. The token in the address is the only credential and opens one piece of work. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const limited = await publicLimit('upload', 120);
    if (limited) return limited;
    const page = await loadUploadPage(services().sql, (await ctx.params).token);
    return page ? json(page, 200, { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' }) : json(GONE, 404);
  } catch (e) { return errorResponse(e); }
}

/** { requestId, name, type, data } with the file as base64. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const bad = requireJson(req);
    if (bad) return bad;
    const limited = await publicLimit('upload-post', 30);
    if (limited) return limited;
    const b = await readJson<{ requestId?: string; name?: string; type?: string; data?: string }>(req);
    await uploadViaLink(services().sql, (await ctx.params).token, String(b.requestId ?? ''), { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') });
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
