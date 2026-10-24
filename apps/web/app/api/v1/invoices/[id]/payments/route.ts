import { listPayments, recordPayment } from '@kora/core';
import { created, v1Route } from '../../../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, params }) => ({ data: await listPayments(sql, t, params.id!) }));

/** Body: { amount: "500.00" (rupees, as text), method: "cash"|"upi"|"bank_transfer"|"cheque"|"card"|"netbanking"|"tds"|"other", receivedOn?: "YYYY-MM-DD", note? }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req, params }) => {
  const b = (await req.json()) as { amount?: unknown; method?: unknown; receivedOn?: string; operationKey?: string; note?: string };
  return created(await recordPayment(sql, t, { documentId: params.id!, amount: String(b.amount ?? ''), method: String(b.method ?? ''), receivedOn: b.receivedOn, note: b.note, operationKey: b.operationKey }));
});
