import { partyOverview } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return (await partyOverview(sql, t, params.id!)) ?? json({ error: 'Customer not found.' }, 404);
});
