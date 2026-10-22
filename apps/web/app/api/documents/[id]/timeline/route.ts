import { paymentTimeline } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

/** The money story of one invoice: issued, each payment with what was left after it, refunds, write-offs, payment links. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Invoice not found.' }, 404);
  return paymentTimeline(sql, t, params.id!);
});
