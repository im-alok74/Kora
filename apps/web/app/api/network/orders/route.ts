import { createOrder, listOrders, type OrderLineIn } from '@kora/core';
import { json, readJson, tenantRoute } from '../../../../lib/server';

/** ?side=sent (orders this business placed) or ?side=received */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const side = new URL(req.url).searchParams.get('side') === 'received' ? 'received' as const : 'sent' as const;
  return { orders: await listOrders(sql, t, side) };
});
/** Body: { sellerBusinessId, lines: [{ name, hsnSac?, unit?, quantity, rate, taxRateBp }], poNumber?, poDate?, expectedOn?, notes? } */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  if (typeof b.sellerBusinessId !== 'string') return json({ error: 'Choose who to order from.' }, 400);
  return createOrder(sql, t, { sellerBusinessId: b.sellerBusinessId, lines: (Array.isArray(b.lines) ? b.lines : []) as OrderLineIn[], poNumber: b.poNumber ? String(b.poNumber) : null, poDate: b.poDate ? String(b.poDate) : undefined, expectedOn: b.expectedOn ? String(b.expectedOn) : null, notes: b.notes == null ? null : String(b.notes) });
});
