import { getReminderConfig, saveReminderConfig } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ config: await getReminderConfig(sql, t) }));
export const PUT = tenantRoute(async ({ t, sql, req }) => ({ config: await saveReminderConfig(sql, t, await req.json()) }));
