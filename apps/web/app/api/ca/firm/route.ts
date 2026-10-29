import { createFirm, listFirmMembers, listFirms, resolveFirm } from '@kora/core';
import { userRoute } from '../../../../lib/server';

/** GET: the firms this person works in, and for the first one its active members and who "you" are. POST { name }: start a firm; you become its partner. */
export const GET = userRoute(async ({ userId, svc }) => {
  const firms = await listFirms(svc.sql, userId);
  if (!firms[0]) return { firms, you: userId, members: [] };
  const members = (await listFirmMembers(svc.sql, await resolveFirm(svc.sql, userId, firms[0].firmId))).filter((m) => m.active);
  return { firms, you: userId, role: firms[0].role, members };
});
export const POST = userRoute(async ({ userId, req, svc }) => {
  const name = String(((await req.json().catch(() => ({}))) as { name?: string }).name ?? '').trim();
  if (!name || name.length > 200) return Response.json({ error: 'Enter your firm name (up to 200 characters).' }, { status: 400 });
  return { id: await createFirm(svc.sql, userId, name) };
});
