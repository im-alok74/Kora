import { upcomingEvents } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Overdue and coming hearings and deadlines across every matter the person can see. ?days=30 */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url).searchParams;
  const kind = u.get('kind');
  return upcomingEvents(sql, t, Number(u.get('days') ?? 30) || 30, kind === 'project' ? 'project' : kind === 'matter' ? 'matter' : undefined);
});
