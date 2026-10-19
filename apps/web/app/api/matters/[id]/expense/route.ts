import { addExpense } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { description, amount, date?, pureAgent?, billable? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  return addExpense(sql, t, params.id!, {
    description: String(b.description ?? ''), amount: String(b.amount ?? ''), date: b.date ? String(b.date) : undefined,
    pureAgent: b.pureAgent === true, billable: b.billable === false ? false : true,
  });
});
