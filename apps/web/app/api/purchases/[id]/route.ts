import { getBill } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Bill not found.' }, 404);
  return (await getBill(sql, t, params.id!)) ?? json({ error: 'Bill not found.' }, 404);
});
