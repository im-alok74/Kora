import { acceptOrder, cancelOrder, declineOrder, getOrder } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Order not found.' }, 404);
  return (await getOrder(sql, t, params.id!)) ?? json({ error: 'Order not found.' }, 404);
});
/** Body: { action: 'accept' } (seller, makes a draft invoice), { action: 'decline', reason } (seller), or { action: 'cancel' } (buyer) */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Order not found.' }, 404);
  const b = await readJson(req);
  if (b.action === 'accept') return acceptOrder(sql, t, params.id!);
  if (b.action === 'decline') { await declineOrder(sql, t, params.id!, String(b.reason ?? '')); return { ok: true }; }
  if (b.action === 'cancel') { await cancelOrder(sql, t, params.id!); return { ok: true }; }
  return json({ error: 'Choose accept, decline or cancel.' }, 400);
});
