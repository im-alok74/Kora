import { portalAttachPo } from '@kora/core';
import { errorResponse, json, readJson, requireJson, services } from '../../../../../../../lib/server';
import { PORTAL_GONE, portalGate } from '../../../../../../../lib/portal';

/** Body: { name, type, dataBase64 }. A purchase order for an estimate: a JPEG, PNG or PDF up to 2 MB. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const bad = requireJson(req);
  if (bad) return bad;
  try {
    const { token, id } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const b = await readJson(req);
    const r = await portalAttachPo(services().sql, token, id, { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.dataBase64 ?? '') });
    return r ? json(r) : json(PORTAL_GONE, 404);
  } catch (e) { return errorResponse(e); }
}
