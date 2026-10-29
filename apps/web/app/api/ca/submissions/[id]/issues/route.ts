import { raiseIssue } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => ({ id: await raiseIssue(sql, s, id, String((await readJson<{ text?: string }>(req.clone())).text ?? '')) }))(req);
}
