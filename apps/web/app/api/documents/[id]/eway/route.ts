import { createEwayBill, ewayOverview, type Transport } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Whether an e-way bill is needed, and the bills already made for this document. */
export const GET = tenantRoute(async ({ t, sql, params }) => ewayOverview(sql, t, params.id!));

/**
 * Body: { transport: { distanceKm, vehicleNo?, transporterId?, transporterName?, mode?, transDocNo?, transDocDate? }, check?: true }.
 * With check it only reports the JSON and any problems; without it, it asks the GST partner for the bill.
 */
export const POST = tenantRoute(async ({ t, sql, req, params, svc }) => {
  const b = await readJson<{ transport?: Transport; check?: boolean }>(req);
  const transport = (b.transport ?? { distanceKm: '' }) as Transport;
  if (b.check === true) return ewayOverview(sql, t, params.id!, transport);
  return createEwayBill(sql, t, svc.gsp, params.id!, transport);
});
