import { applyCredit } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Applies money held for the invoice's customer, oldest first. Body: { amount? } to apply less than what is due. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ amount?: string }>(req);
  return applyCredit(sql, t, { documentId: params.id!, amount: b.amount });
});
