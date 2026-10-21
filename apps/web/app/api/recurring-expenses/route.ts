import { createRecurringExpense, listRecurringExpenses, type RecurringExpenseIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ recurringExpenses: await listRecurringExpenses(sql, t) }));
export const POST = tenantRoute(async ({ t, sql, req }) => createRecurringExpense(sql, t, (await readJson(req)) as unknown as RecurringExpenseIn));
