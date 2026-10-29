import { acceptClientLink, listBusinessLinks, revokeBusinessLink } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** The business owner's side: see which firms can read this business, accept a firm's code, or stop one. */
export const GET = tenantRoute(async ({ t, sql }) => ({ links: await listBusinessLinks(sql, t) }));
export const POST = tenantRoute(async ({ t, sql, req }) => {
  await acceptClientLink(sql, t, String((await readJson<{ code?: string }>(req)).code ?? ''));
  return { ok: true };
});
export const DELETE = tenantRoute(async ({ t, sql, req }) => {
  await revokeBusinessLink(sql, t, String((await readJson<{ linkId?: string }>(req)).linkId ?? ''));
  return { ok: true };
});
