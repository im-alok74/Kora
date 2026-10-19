import { findItemByBarcode } from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

/** The item for a scanned code. ?code=8901234567890 */
export const GET = tenantRoute(async ({ t, sql, req }) => (await findItemByBarcode(sql, t, new URL(req.url).searchParams.get('code') ?? '')) ?? json({ error: 'No item has that barcode.' }, 404));
