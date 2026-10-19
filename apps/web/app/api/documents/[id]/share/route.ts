import { createShareLink, revokeShareLinks, shareStats } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ stats: await shareStats(sql, t, params.id!) }));
export const POST = tenantRoute(async ({ t, sql, params, svc }) => {
  const { token } = await createShareLink(sql, t, params.id!);
  return { url: `${svc.appUrl.replace(/\/$/, '')}/i/${token}` };
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await revokeShareLinks(sql, t, params.id!); });
