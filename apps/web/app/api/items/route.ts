import { createItem, listItems, type ItemInput } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => ({ items: await listItems(sql, t, { q: new URL(req.url).searchParams.get('q') ?? undefined }) }));
export const POST = tenantRoute(async ({ t, sql, req }) => ({ id: await createItem(sql, t, (await req.json()) as ItemInput) }));
