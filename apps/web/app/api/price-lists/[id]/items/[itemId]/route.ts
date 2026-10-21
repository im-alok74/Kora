import { removePriceListEntry } from '@kora/core';
import { tenantRoute } from '../../../../../../lib/server';

export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removePriceListEntry(sql, t, params.id!, params.itemId!); });
