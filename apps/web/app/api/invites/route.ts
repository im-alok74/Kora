import { answerBusinessInvite, listMyBusinessInvites } from '@kora/core';
import { userRoute } from '../../../lib/server';

/** The businesses that have invited the signed-in person. */
export const GET = userRoute(async ({ userId, svc }) => ({ invites: await listMyBusinessInvites(svc.sql, userId) }));

/** { businessId, accept }: the person answers a business's invitation. Nothing of the business is open to them until they accept. */
export const POST = userRoute(async ({ userId, req, svc }) => {
  const b = (await req.json().catch(() => ({}))) as { businessId?: unknown; accept?: unknown };
  await answerBusinessInvite(svc.sql, userId, String(b.businessId ?? ''), b.accept === true);
  return { ok: true };
});
