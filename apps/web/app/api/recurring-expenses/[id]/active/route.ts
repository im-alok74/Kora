import { resumeRecurringExpense, stopRecurringExpense } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) =>
  ((await readJson(req)).active === true ? resumeRecurringExpense : stopRecurringExpense)(sql, t, params.id!));
