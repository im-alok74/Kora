import { inviteFirmMember, removeFirmMemberChecked } from '@kora/core';
import { firmRoute } from '../../../../lib/firmroute';
import { readJson } from '../../../../lib/server';

/** { identifier: mobile or email, role }: adds the person, or changes their role. Partners only. */
export const POST = firmRoute(async ({ s, req, sql }) => {
  const b = await readJson<{ identifier?: string; role?: string }>(req);
  return inviteFirmMember(sql, s, { identifier: String(b.identifier ?? ''), role: String(b.role ?? '') });
});
/** ?userId=: removes the person from the firm. The last partner cannot be removed. */
export const DELETE = firmRoute(async ({ s, req, sql }) => {
  await removeFirmMemberChecked(sql, s, String(new URL(req.url).searchParams.get('userId') ?? ''));
  return { ok: true };
});
