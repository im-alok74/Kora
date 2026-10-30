import { firmOverview, pilotMetrics, seesAllClients } from '@kora/core';
import { firmRoute } from '../../../../lib/firmroute';

/** The counts behind the Work cards, and for partners and managers the firm-wide measurements for the last 90 days. */
export const GET = firmRoute(async ({ s, req, sql }) => {
  const days = Number(new URL(req.url).searchParams.get('days') ?? 90);
  return { overview: await firmOverview(sql, s), metrics: seesAllClients(s.role) ? await pilotMetrics(sql, s, days) : null };
});
