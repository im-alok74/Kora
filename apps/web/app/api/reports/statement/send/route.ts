import { queueStatementSend } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Emails a customer their statement of account. The worker rebuilds and sends it; this only queues the job. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ party?: string; from?: string; to?: string; contactPersonId?: string | null; email?: string | null }>(req);
  return queueStatementSend(sql, t, {
    partyId: b.party ?? '', from: b.from, to: b.to, contactPersonId: b.contactPersonId ?? null, email: b.email ?? null,
  });
});
