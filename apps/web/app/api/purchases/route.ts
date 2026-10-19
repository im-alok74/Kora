import { createBill, listBills, type BillIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url).searchParams;
  return { bills: await listBills(sql, t, { q: u.get('q') ?? undefined, state: u.get('state') ?? undefined, from: u.get('from') ?? undefined, to: u.get('to') ?? undefined, limit: Number(u.get('limit') ?? 100) || 100 }) };
});

/** Body: { partyId, billNumber, billDate, dueDate?, reverseCharge?, itcStatus?, itcReason?, notes?, lines: [{ description, hsnSac?, quantity, rate, discount?, taxRateBp, cessRateBp? }] } */
export const POST = tenantRoute(async ({ t, sql, req }) => createBill(sql, t, (await readJson(req)) as unknown as BillIn));
