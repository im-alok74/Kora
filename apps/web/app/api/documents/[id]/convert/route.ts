import { convertDocument } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { target: 'sales_order' | 'proforma' | 'delivery_challan' | 'invoice' }. Makes a draft from an issued document and returns its id. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => convertDocument(sql, t, params.id!, String((await readJson(req)).target ?? '')));
