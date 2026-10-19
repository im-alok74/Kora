import { payInvoiceFromHeld } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { documentId, amount? }. Pays an invoice from the money held for this client; with no amount, as much as is due or held. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  if (!isUuid(String(b.documentId ?? ''))) return json({ error: 'Choose an invoice.' }, 400);
  return payInvoiceFromHeld(sql, t, params.id!, { documentId: String(b.documentId), amount: b.amount ? String(b.amount) : undefined });
});
