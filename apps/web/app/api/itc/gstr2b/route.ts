import { importGstr2b, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { period: '2026-10', json: <the GSTR-2B JSON downloaded from the GST portal> } */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  if (typeof b.json !== 'object' || b.json === null) throw new ValidationError('Choose the GSTR-2B JSON file.', 'json');
  return importGstr2b(sql, t, String(b.period ?? ''), b.json);
});
