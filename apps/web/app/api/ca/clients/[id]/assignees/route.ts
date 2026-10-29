import { assignClient, listAssignees, unassignClient } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

type Ctx = { params: Promise<{ id: string }> };
const route = (fn: (a: Parameters<Parameters<typeof firmRoute>[0]>[0], id: string, userId: string) => Promise<unknown>) =>
  async (req: Request, ctx: Ctx) => {
    const { id } = await ctx.params;
    // The body for POST; the query string for DELETE, because the browser helper sends no body with DELETE.
    return firmRoute(async (a) => fn(a, id, String(new URL(a.req.url).searchParams.get('userId') ?? (await readJson<{ userId?: string }>(a.req.clone())).userId ?? '')))(req);
  };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => ({ assignees: await listAssignees(sql, s, id) }))(req);
}
export const POST = route(async ({ s, sql }, id, userId) => { await assignClient(sql, s, id, userId); return { ok: true }; });
export const DELETE = route(async ({ s, sql }, id, userId) => { await unassignClient(sql, s, id, userId); return { ok: true }; });
