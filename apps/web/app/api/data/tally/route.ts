import { exportTally } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** A Tally import file for the dates given. Ledger names come from the query (company, salesLedger, cgstLedger and so on). */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  const config = Object.fromEntries([...q.entries()].filter(([k]) => k !== 'from' && k !== 'to'));
  const x = await exportTally(sql, t, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, config });
  return new Response(x.xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="${x.filename}"`, 'cache-control': 'no-store', 'x-kora-counts': JSON.stringify(x.counts) },
  });
}) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
