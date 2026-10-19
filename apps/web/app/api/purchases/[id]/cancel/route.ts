import { cancelBill } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Bill not found.' }, 404);
  await cancelBill(sql, t, params.id!);
});
