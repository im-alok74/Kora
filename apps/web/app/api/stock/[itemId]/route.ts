import { adjustStock, stockHistory } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.itemId!)) return json({ error: 'Item not found.' }, 404);
  return { movements: await stockHistory(sql, t, params.itemId!) };
});
/** Body: { mode: 'in' | 'out' | 'count', quantity, note?, date? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.itemId!)) return json({ error: 'Item not found.' }, 404);
  const b = await readJson(req);
  return adjustStock(sql, t, params.itemId!, { mode: String(b.mode ?? '') as 'in', quantity: String(b.quantity ?? ''), note: b.note == null ? null : String(b.note), date: b.date ? String(b.date) : undefined });
});
