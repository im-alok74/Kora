import { removeFromInbox, reviewInbox, type InboxStatus } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { status: 'new' | 'done' | 'rejected', reviewNote? }. */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  await reviewInbox(sql, t, params.id!, { status: String(b.status ?? '') as InboxStatus, reviewNote: b.reviewNote == null ? null : String(b.reviewNote) });
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removeFromInbox(sql, t, params.id!); });
