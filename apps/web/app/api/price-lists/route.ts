import { createPriceList, listPriceLists, type PriceListInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

/** { priceLists: [{ id, name, kind, markup_bp, rounding, entries, customers }] } */
export const GET = tenantRoute(async ({ t, sql }) => ({ priceLists: await listPriceLists(sql, t) }));
/** Body: { name, kind: 'fixed' | 'percentage', markupBp? (signed basis points, percentage only), rounding? ('paise' | 'rupee') }. */
export const POST = tenantRoute(async ({ t, sql, req }) => ({ id: await createPriceList(sql, t, await readJson<PriceListInput>(req)) }));
