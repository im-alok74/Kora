import { upcomingEvents } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Overdue and coming hearings and deadlines across every matter the person can see. ?days=30 */
export const GET = tenantRoute(async ({ t, sql, req }) => upcomingEvents(sql, t, Number(new URL(req.url).searchParams.get('days') ?? 30) || 30));
