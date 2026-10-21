import { setPriceListEntry, type PriceListEntryInput } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Sets one item's price on the list, replacing any earlier one. Body: { itemId, price (rupees), priceIncludesTax? (null = as the item says) }. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => { await setPriceListEntry(sql, t, params.id!, await readJson<PriceListEntryInput>(req)); });
