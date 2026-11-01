import { listPayments, recordPayment } from '@kora/core';
import { created, ok, v1Route } from '../../../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, params }) => ({ data: await listPayments(sql, t, params.id!) }));

/**
 * Send an Idempotency-Key header (8 to 64 letters, digits, - or _) and a retry of the same request returns the first payment (status 200)
 * instead of recording the money again. Use a key that belongs to the money, such as your own payment reference.
 * Body: { amount: "500.00" (rupees, as text), method: "cash"|"upi"|"bank_transfer"|"cheque"|"card"|"netbanking"|"tds"|"other", receivedOn?: "YYYY-MM-DD", note? }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req, params }) => {
  const b = (await req.json()) as { amount?: unknown; method?: unknown; receivedOn?: string; note?: string };
  const r = await recordPayment(sql, t, { documentId: params.id!, amount: String(b.amount ?? ''), method: String(b.method ?? ''), receivedOn: b.receivedOn, note: b.note, idempotencyKey: req.headers.get('idempotency-key') });
  return (r.replayed ? ok : created)(r);
});
