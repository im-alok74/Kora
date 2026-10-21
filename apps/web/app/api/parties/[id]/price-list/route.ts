import { assignPriceList } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Gives the customer a price list. Body: { priceListId } or { priceListId: null } to take it away. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await assignPriceList(sql, t, params.id!, (await readJson<{ priceListId: string | null }>(req)).priceListId ?? null); });
