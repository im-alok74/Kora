import { answerFirmInvite } from '@kora/core';
import { userRoute } from '../../../../../lib/server';

/** { firmId, accept }: the person answers a firm's invitation. */
export const POST = userRoute(async ({ userId, req, svc }) => {
  const b = (await req.json().catch(() => ({}))) as { firmId?: unknown; accept?: unknown };
  await answerFirmInvite(svc.sql, userId, String(b.firmId ?? ''), b.accept === true);
  return { ok: true };
});
