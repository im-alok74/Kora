import { deliveryStatus } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

/** What became of this invoice if it was sent through Kora to another business. null when it was not. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Document not found.' }, 404);
  return { delivery: await deliveryStatus(sql, t, params.id!) };
});
