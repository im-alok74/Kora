import { refundCredit } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { amount, method, refundedOn?, note? }. Returns money held for a customer that has not been applied to any invoice. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ amount?: string; method?: string; refundedOn?: string; note?: string }>(req);
  return refundCredit(sql, t, params.id!, { amount: String(b.amount ?? ''), method: String(b.method ?? ''), refundedOn: b.refundedOn, note: b.note });
});
