import { gstinValid } from '@kora/tax';
import { tenantRoute } from '../../../../lib/server';

/** Fills what the GSTIN itself contains. Name and address need the GST partner (not connected yet). */
export const GET = tenantRoute(async ({ params, svc }) => {
  const g = (params.gstin ?? '').toUpperCase();
  if (!gstinValid(g)) return { valid: false };
  return { valid: true, info: await svc.gstin.lookup(g) };
});
