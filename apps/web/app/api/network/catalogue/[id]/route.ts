import { networkCatalogue } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'That business is not listed.' }, 404);
  return (await networkCatalogue(sql, t, params.id!)) ?? json({ error: 'That business is not listed.' }, 404);
});
