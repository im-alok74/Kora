import { listPayments, recordPayment } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ payments: await listPayments(sql, t, params.id!) }));
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ amount?: string; method?: string; receivedOn?: string; operationKey?: string; note?: string }>(req);
  return recordPayment(sql, t, { documentId: params.id!, amount: String(b.amount ?? ''), method: String(b.method ?? ''), receivedOn: b.receivedOn, note: b.note, operationKey: b.operationKey });
});
