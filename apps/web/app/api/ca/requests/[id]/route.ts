import { reviewRequest, type ReviewDecision } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { readJson } from '../../../../../lib/server';

/** { decision: accepted | needs_correction | waived | requested, reason? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ decision?: ReviewDecision; reason?: string | null }>(req.clone());
    await reviewRequest(sql, s, id, { decision: b.decision as ReviewDecision, reason: b.reason ?? null });
    return { ok: true };
  })(req);
}
