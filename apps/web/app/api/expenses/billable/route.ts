import { listBillable } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Expenses marked billable to a customer and not yet on an invoice. ?party=id narrows it to one customer. */
export const GET = tenantRoute(async ({ t, sql, req }) => ({ expenses: await listBillable(sql, t, new URL(req.url).searchParams.get('party') ?? undefined) }));
