import { getClientLink, linkedClientReconciliation, linkedClientSummary, previousPeriod, requestClientLink, revokeClientLink } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';

type Ctx = { params: Promise<{ id: string }> };
/** GET: link state, plus the linked business's dashboard when active. POST: start a link (the code is shown once). DELETE: stop. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const link = await getClientLink(sql, s, id);
    return link.status === 'active' ? { link, summary: await linkedClientSummary(sql, s, id), reconciliation: await linkedClientReconciliation(sql, s, id, previousPeriod()) } : { link };
  })(req);
}
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => requestClientLink(sql, s, id))(req);
}
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => { await revokeClientLink(sql, s, id); return { ok: true }; })(req);
}
