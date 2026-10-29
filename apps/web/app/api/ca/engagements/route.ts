import { listEngagements, type EngagementStatus } from '@kora/core';
import { firmRoute } from '../../../../lib/firmroute';

export const GET = firmRoute(async ({ s, req, sql }) => {
  const u = new URL(req.url);
  return listEngagements(sql, s, {
    period: u.searchParams.get('period') ?? undefined, status: (u.searchParams.get('status') as EngagementStatus | null) ?? undefined,
    limit: Number(u.searchParams.get('limit') ?? 100), offset: Number(u.searchParams.get('offset') ?? 0),
  });
});
