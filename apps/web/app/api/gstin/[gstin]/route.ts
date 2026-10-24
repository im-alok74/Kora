import { gstinValid } from '@kora/tax';
import { tenantRoute } from '../../../../lib/server';
import { publicLimit } from '../../../../lib/publicLimit';

/** Fills what the GSTIN itself contains. Name and address need the GST partner (not connected yet). */
export const GET = tenantRoute(async ({ params, svc }) => {
  const limited = await publicLimit('gstin', 120);
  if (limited) return limited;
  const g = (params.gstin ?? '').toUpperCase();
  if (!gstinValid(g)) return { valid: false };
  return { valid: true, info: await svc.gstin.lookup(g) };
});
