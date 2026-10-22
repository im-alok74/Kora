import { invoiceBillableExpenses, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { partyId, expenseIds, taxRateBp? }. Makes a DRAFT invoice with a line for each expense. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  if (!Array.isArray(b.expenseIds)) throw new ValidationError('Choose at least one expense.', 'expenseIds');
  return invoiceBillableExpenses(sql, t, { partyId: String(b.partyId ?? ''), expenseIds: b.expenseIds.map(String), taxRateBp: b.taxRateBp === undefined ? undefined : Number(b.taxRateBp) });
});
