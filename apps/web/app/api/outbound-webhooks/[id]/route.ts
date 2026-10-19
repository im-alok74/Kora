import { deleteWebhook, updateWebhook } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: any of { active, events, description }. */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => { await updateWebhook(sql, t, params.id!, await readJson(req)); });
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await deleteWebhook(sql, t, params.id!); });
