import { bankPreview } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { csv } with the text of a bank statement. Returns every line with up to three suggested invoices or bills. Writes nothing. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ csv?: string }>(req);
  return bankPreview(sql, t, String(b.csv ?? ''));
});
