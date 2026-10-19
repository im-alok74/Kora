import { correctBuyer } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

/** Fixes buyer details on an invoice that has no IRN yet. The state cannot change. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<Record<string, string>>(req);
  return correctBuyer(sql, t, params.id!, { gstin: b.gstin, name: b.name, line1: b.line1, line2: b.line2, city: b.city, pincode: b.pincode });
});
