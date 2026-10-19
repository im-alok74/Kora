import { createShareLink } from '@kora/core';
import { created, v1Route } from '../../../../../../lib/apiV1';

/** A public link to an issued document that the customer can open without signing in. Valid for 30 days. */
export const POST = v1Route({ write: true }, async ({ t, sql, params, appUrl }) => {
  const { token } = await createShareLink(sql, t, params.id!, { expiresInDays: 30 });
  return created({ url: `${appUrl.replace(/\/$/, '')}/i/${token}` });
});
