import { createUploadLink, revokeUploadLink } from '@kora/core';
import { firmRoute } from '../../../../../../lib/firmroute';
import { services } from '../../../../../../lib/server';

type Ctx = { params: Promise<{ id: string }> };
/** Makes a link for the client (any earlier one stops working). The address is shown once; Kora keeps only its hash. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => {
    const { token, expiresAt } = await createUploadLink(sql, s, id);
    return { url: `${services().appUrl}/send/${token}`, expiresAt };
  })(req);
}
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return firmRoute(async ({ s, sql }) => { await revokeUploadLink(sql, s, id); return { ok: true }; })(req);
}
