import { addDefaultChecklist, addRequest, listRequests, uploadLinkState } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => ({ requests: await listRequests(sql, s, id), link: await uploadLinkState(sql, s, id) }))(req);
}
/** { defaults: true } adds the standard items; { label, dueDate? } adds one. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ defaults?: boolean; label?: string; dueDate?: string | null }>(req.clone());
    if (b.defaults) return { added: await addDefaultChecklist(sql, s, id) };
    return { id: await addRequest(sql, s, id, { label: String(b.label ?? ''), dueDate: b.dueDate ?? null }) };
  })(req);
}
