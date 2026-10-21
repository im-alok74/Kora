import { resolveItemPrice } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** The price for a new line. ?item=<id>&party=<id> -> { pricePaise, priceIncludesTax, source: 'list' | 'item', priceListId }. */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  return resolveItemPrice(sql, t, { itemId: q.get('item') ?? '', partyId: q.get('party') });
});
