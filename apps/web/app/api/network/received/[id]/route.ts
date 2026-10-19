import { acceptReceivedInvoice, rejectReceivedInvoice } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { action: 'accept' } or { action: 'reject', reason } */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'That invoice was not found.' }, 404);
  const b = await readJson(req);
  if (b.action === 'accept') return acceptReceivedInvoice(sql, t, params.id!);
  if (b.action === 'reject') { await rejectReceivedInvoice(sql, t, params.id!, String(b.reason ?? '')); return { ok: true }; }
  return json({ error: 'Choose accept or reject.' }, 400);
});
