import { cancelEwayBill } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../../lib/server';

/** Body: { reason: "duplicate" | "order_cancelled" | "mistake" | "other", remark }. Only within 24 hours of making the bill. */
export const POST = tenantRoute(async ({ t, sql, req, params, svc }) => {
  const b = await readJson<{ reason?: string; remark?: string }>(req);
  return cancelEwayBill(sql, t, svc.gsp, params.ewayId!, { reason: String(b.reason ?? ''), remark: String(b.remark ?? '') });
});
