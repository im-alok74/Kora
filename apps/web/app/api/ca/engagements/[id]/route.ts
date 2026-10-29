import { assignEngagement, clearBlocker, setBlocker, setEngagementDates, setEngagementStatus, type BlockerParty, type EngagementStatus } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { readJson } from '../../../../../lib/server';

type Body = {
  status?: EngagementStatus; ownerId?: string | null; reviewerId?: string | null;
  blocker?: { reason: string; party: BlockerParty; nextAction?: string; expected?: string | null } | null;
  statutoryDeadline?: string | null; deadlineSource?: string; internalTarget?: string | null;
};

/** PATCH any of: status, ownerId/reviewerId, blocker (an object sets it, null clears it), dates. Each part checks its own permission. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<Body>(req.clone());
    if (b.ownerId !== undefined || b.reviewerId !== undefined) await assignEngagement(sql, s, id, { ownerId: b.ownerId, reviewerId: b.reviewerId });
    if (b.statutoryDeadline !== undefined || b.internalTarget !== undefined) await setEngagementDates(sql, s, id, { statutoryDeadline: b.statutoryDeadline, source: b.deadlineSource, internalTarget: b.internalTarget });
    if (b.blocker === null) await clearBlocker(sql, s, id);
    else if (b.blocker) await setBlocker(sql, s, id, b.blocker);
    if (b.status) await setEngagementStatus(sql, s, id, b.status);
    return { ok: true };
  })(req);
}
