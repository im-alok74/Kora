import { addStaffVersion } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { readJson } from '../../../../../../lib/server';

/** { name, type, data } with the file as base64: a firm member adds a file for the client. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const b = await readJson<{ name?: string; type?: string; data?: string }>(req.clone());
    return { id: await addStaffVersion(sql, s, id, { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') }) };
  })(req);
}
