import { payBill } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { amount, method?, paidOn?, note?, tds?, tdsSection? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Bill not found.' }, 404);
  const b = await readJson(req);
  return payBill(sql, t, params.id!, { amount: String(b.amount ?? ''), method: b.method ? String(b.method) : undefined, paidOn: b.paidOn ? String(b.paidOn) : undefined, note: b.note == null ? null : String(b.note), tds: b.tds ? String(b.tds) : null, tdsSection: b.tdsSection ? String(b.tdsSection) : null });
});
