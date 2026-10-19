import { createPortalLink, portalStatus, revokePortalLink } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** The business side of a customer's portal link. The link itself is shown once, when it is made. */
export const GET = tenantRoute(async ({ t, sql, params }) => portalStatus(sql, t, params.id!));
export const POST = tenantRoute(async ({ t, sql, svc, params }) => {
  const { token } = await createPortalLink(sql, t, params.id!);
  return { token, url: `${svc.appUrl}/portal/${token}` };
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await revokePortalLink(sql, t, params.id!); });
