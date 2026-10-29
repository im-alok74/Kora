import { closeEngagement } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';

/** Finishes the work. Refused unless the review is approved and unchanged, a filing is recorded, and nothing is holding it up. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => { await closeEngagement(sql, s, id); return { ok: true }; })(req);
}
