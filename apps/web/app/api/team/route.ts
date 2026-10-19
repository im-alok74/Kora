import { inviteMember, listMembers } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ members: await listMembers(sql, t), you: t.userId }));
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ identifier?: string; role?: string }>(req);
  return inviteMember(sql, t, { identifier: String(b.identifier ?? ''), role: String(b.role ?? '') });
});
