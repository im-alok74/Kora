import { cancelMemberInvite } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const DELETE = tenantRoute(async ({ t, sql, params }) => { await cancelMemberInvite(sql, t, params.userId!); return { ok: true }; });
