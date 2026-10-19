import { previewTotals, type DocIn } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Live totals for the editor. Same code path as saving, so the screen cannot disagree with the invoice. */
export const POST = tenantRoute(async ({ t, sql, req }) => previewTotals(sql, t, (await req.json()) as DocIn));
