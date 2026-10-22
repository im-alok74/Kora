import { refundInvoicePayment } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../../lib/server';

/** Body: { amount, method, refundedOn?, note? }. Takes the money off the invoice and records giving it back. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Payment not found.' }, 404);
  const b = await readJson(req);
  return refundInvoicePayment(sql, t, { allocationId: params.id!, amount: String(b.amount ?? ''), method: String(b.method ?? ''), refundedOn: b.refundedOn ? String(b.refundedOn) : undefined, note: b.note == null ? null : String(b.note) });
});
