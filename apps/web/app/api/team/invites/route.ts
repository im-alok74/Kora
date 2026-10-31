import { listMemberInvites } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Invitations this business has sent that have not been answered. Owners only. */
export const GET = tenantRoute(async ({ t, sql }) => ({ invites: await listMemberInvites(sql, t) }));
