import { itcSummary, ValidationError } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

/** Input tax credit for a month. ?period=2026-10 */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const period = new URL(req.url).searchParams.get('period');
  if (!period) throw new ValidationError('Choose a month.', 'period');
  return itcSummary(sql, t, period);
});
