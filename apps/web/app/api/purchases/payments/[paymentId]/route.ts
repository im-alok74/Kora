import { removeBillPayment } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

export const DELETE = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.paymentId!)) return json({ error: 'Payment not found.' }, 404);
  await removeBillPayment(sql, t, params.paymentId!);
});
