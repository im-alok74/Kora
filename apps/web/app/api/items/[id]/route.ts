import { archiveItem, updateItem, type ItemInput } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await updateItem(sql, t, params.id!, (await req.json()) as ItemInput); });
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archiveItem(sql, t, params.id!); });
