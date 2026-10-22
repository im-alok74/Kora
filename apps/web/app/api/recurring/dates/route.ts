import { ValidationError, upcomingDates } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { startDate, everyN, unit, endDate? }. The dates a schedule would run on, for the form to show before saving. */
export const POST = tenantRoute(async ({ req }) => {
  const b = await readJson(req);
  const unit = b.unit;
  if (unit !== 'week' && unit !== 'month' && unit !== 'year') throw new ValidationError('Choose weeks, months or years.', 'unit');
  const everyN = Number(b.everyN);
  if (!Number.isInteger(everyN) || everyN < 1 || everyN > 24) throw new ValidationError('Repeat every 1 to 24.', 'everyN');
  const startDate = String(b.startDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) throw new ValidationError('Enter the first date as YYYY-MM-DD.', 'startDate');
  const endDate = b.endDate ? String(b.endDate) : null;
  return { dates: upcomingDates({ startDate, everyN, unit, endDate }, 6) };
});
