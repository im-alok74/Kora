import { archivePriceList, getPriceList, updatePriceList, type PriceListInput } from '@kora/core';
import { json, readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const l = await getPriceList(sql, t, params.id!);
  return l ? { priceList: l } : json({ error: 'Price list not found.' }, 404);
});
export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await updatePriceList(sql, t, params.id!, await readJson<PriceListInput>(req)); });
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archivePriceList(sql, t, params.id!); });
