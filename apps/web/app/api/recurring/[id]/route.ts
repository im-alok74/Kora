import { deleteRecurring, getRecurring, updateRecurring, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const r = await getRecurring(sql, t, params.id!);
  if (!r) throw new ValidationError('Recurring invoice not found.');
  return r;
});
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => updateRecurring(sql, t, params.id!, (await readJson(req)) as never));
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await deleteRecurring(sql, t, params.id!); });
