import { reviewState, submitForReview } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => reviewState(sql, s, id))(req);
}
/** Hands the work to the reviewer as a new frozen version. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => submitForReview(sql, s, id))(req);
}
