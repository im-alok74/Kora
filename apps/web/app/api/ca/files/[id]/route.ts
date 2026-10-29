import { getVersionFile } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { json } from '../../../../../lib/server';

/** Download one file the firm holds. Sent as an attachment so a browser never runs it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const f = await getVersionFile(sql, s, id);
    if (!f) return json({ error: 'Not found.' }, 404);
    return new Response(new Uint8Array(f.data), { headers: {
      'content-type': f.type, 'content-disposition': `attachment; filename="${f.name.replace(/"/g, '')}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
    } });
  })(req);
}
