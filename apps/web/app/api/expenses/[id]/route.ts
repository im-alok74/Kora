import { deleteExpense, getExpense, saveExpense, ValidationError, type ExpenseIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const e = await getExpense(sql, t, params.id!);
  if (!e) throw new ValidationError('Expense not found.');
  return e;
});
export const PUT = tenantRoute(async ({ t, sql, req, params }) => saveExpense(sql, t, (await readJson(req)) as unknown as ExpenseIn, params.id!));
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await deleteExpense(sql, t, params.id!); });
