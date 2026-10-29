import { decideSubmission } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { readJson } from '../../../../../lib/server';

/** { decision: approved | returned, note? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ decision?: 'approved' | 'returned'; note?: string | null }>(req.clone());
    await decideSubmission(sql, s, id, { decision: b.decision as 'approved' | 'returned', note: b.note ?? null });
    return { ok: true };
  })(req);
}
