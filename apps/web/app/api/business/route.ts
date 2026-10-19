import { getBusiness, updateBusinessProfile, type BusinessProfileInput } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ business: await getBusiness(sql, t), role: t.role }));
export const PUT = tenantRoute(async ({ t, sql, req }) => {
  await updateBusinessProfile(sql, t, (await req.json()) as BusinessProfileInput);
  return { business: await getBusiness(sql, t) };
});
