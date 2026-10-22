import { saveMileage } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { date?, from?, to?, km, ratePerKm, notes?, billToPartyId? }. Saved as an expense in the Mileage category. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return saveMileage(sql, t, { date: b.date ? String(b.date) : undefined, from: b.from ? String(b.from) : undefined, to: b.to ? String(b.to) : undefined, km: String(b.km ?? ''), ratePerKm: String(b.ratePerKm ?? ''), notes: b.notes ? String(b.notes) : null, billToPartyId: b.billToPartyId ? String(b.billToPartyId) : null });
});
