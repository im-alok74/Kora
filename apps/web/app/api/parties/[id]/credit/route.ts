import { partyCredit, recordAdvance } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** What is held for this customer: { totalPaise, payments: [{ id, available_paise, method, received_on, note }] }. */
export const GET = tenantRoute(async ({ t, sql, params }) => partyCredit(sql, t, params.id!));
/** Body: { amount, method, receivedOn?, note? }. Records money received before there is an invoice for it. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ amount?: string; method?: string; receivedOn?: string; note?: string }>(req);
  return recordAdvance(sql, t, { partyId: params.id!, amount: String(b.amount ?? ''), method: String(b.method ?? ''), receivedOn: b.receivedOn, note: b.note });
});
