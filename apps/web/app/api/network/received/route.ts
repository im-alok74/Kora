import { listReceivedInvoices } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Invoices other Kora businesses sent to this one. ?status=new */
export const GET = tenantRoute(async ({ t, sql, req }) => ({ invoices: await listReceivedInvoices(sql, t, { status: new URL(req.url).searchParams.get('status') ?? undefined }) }));
