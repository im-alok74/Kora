import { archiveRecurringExpense, getRecurringExpense, updateRecurringExpense, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const r = await getRecurringExpense(sql, t, params.id!);
  if (!r) throw new ValidationError('Recurring expense not found.');
  return r;
});
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => updateRecurringExpense(sql, t, params.id!, (await readJson(req)) as never));
/** Archives the schedule. The expenses it already recorded are kept. */
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archiveRecurringExpense(sql, t, params.id!); });
