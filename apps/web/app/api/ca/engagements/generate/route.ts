import { generateEngagements } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { readJson } from '../../../../../lib/server';

/** { period: "2026-09" }: creates that month's engagements. Safe to repeat. */
export const POST = firmRoute(async ({ s, req, sql }) => generateEngagements(sql, s, String((await readJson<{ period?: string }>(req)).period ?? '')));
