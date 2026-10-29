import { addFilingEvidence, listFilingEvidence } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => ({ evidence: await listFilingEvidence(sql, s, id) }))(req);
}
/** { reference, filedOn, name, type, data } with the acknowledgement as base64. This is the firm's own record, not a check with the portal. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ reference?: string; filedOn?: string; name?: string; type?: string; data?: string }>(req.clone());
    return { id: await addFilingEvidence(sql, s, id, { reference: String(b.reference ?? ''), filedOn: String(b.filedOn ?? ''), file: { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') } }) };
  })(req);
}
