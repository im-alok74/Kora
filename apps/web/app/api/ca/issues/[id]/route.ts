import { resolveIssue } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';

/** Marks a raised point as dealt with. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => { await resolveIssue(sql, s, id); return { ok: true }; })(req);
}
