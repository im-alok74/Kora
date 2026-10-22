import { setPortalCodeLogin, ValidationError } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../../lib/server';

/** Body: { codeLogin: boolean }. Ask the customer for a one-time code before the portal opens. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  const b = await readJson(req);
  if (typeof b.codeLogin !== 'boolean') throw new ValidationError('Say whether to ask for a code.', 'codeLogin');
  await setPortalCodeLogin(sql, t, params.id!, b.codeLogin);
  return { codeLogin: b.codeLogin };
});
