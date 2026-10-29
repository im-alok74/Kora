import { planReminders, reminderSummary } from '@kora/core';
import { firmRoute } from '../../../../lib/firmroute';

/** GET: how many reminders are queued, sent and failed. POST: decide which open items need one now. Nothing is sent by this. */
export const GET = firmRoute(async ({ s, sql }) => reminderSummary(sql, s));
export const POST = firmRoute(async ({ s, sql }) => ({ ...(await planReminders(sql, s)), summary: await reminderSummary(sql, s) }));
