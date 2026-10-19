import { addFunds } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { kind: 'deposit' | 'refund' | 'applied', amount, date?, note? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  return addFunds(sql, t, params.id!, {
    kind: String(b.kind ?? '') as 'deposit', amount: String(b.amount ?? ''), date: b.date ? String(b.date) : undefined, note: b.note == null ? null : String(b.note),
  });
});
