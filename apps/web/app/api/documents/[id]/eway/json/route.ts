import { ewayPortalJson, type Transport } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

/** Body: { transport }. The JSON for the e-way bill portal's own bulk upload page, for a business with no partner connection yet. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ transport?: Transport }>(req);
  return ewayPortalJson(sql, t, params.id!, (b.transport ?? { distanceKm: '' }) as Transport);
});
