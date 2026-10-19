import { completeSale, type LineIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { lines: [{ itemId?, name, hsnSac?, quantity, rate, taxRateBp, taxInclusive?, kind? }], partyId?, method?, note? }. Makes the bill, issues it and records the payment. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return completeSale(sql, t, { lines: (Array.isArray(b.lines) ? b.lines : []) as LineIn[], partyId: b.partyId ? String(b.partyId) : null, method: b.method ? String(b.method) : undefined, note: b.note == null ? null : String(b.note) });
});
