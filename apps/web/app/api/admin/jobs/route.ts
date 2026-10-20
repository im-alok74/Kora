import { timingSafeEqual } from 'node:crypto';
import { errorResponse, json, services } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Operator-only. Same bearer secret as the cron tick; refuses everyone when CRON_SECRET is not set. */
function guard(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return json({ error: 'Not configured. Set CRON_SECRET (16 or more characters).' }, 503);
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return same(given, secret) ? null : json({ error: 'Not allowed.' }, 401);
}

/** Queue health: counts by queue and status, the oldest waiting job, and the latest failures (no payloads). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { sql } = services();
    const counts = await sql`select queue, status, count(*)::int as n, min(run_at) filter (where status = 'queued') as oldest_waiting from job group by queue, status order by queue, status`;
    const failed = await sql`select id, queue, business_id, attempts, last_error, updated_at from job where status = 'failed' order by updated_at desc limit 25`;
    return json({ counts, failed });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Body: { queue?: string }. Puts failed jobs (of one queue, or all) back in line with a fresh attempt count. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { sql } = services();
    const body = (await req.json().catch(() => ({}))) as { queue?: string };
    const rows = await sql`update job set status = 'queued', attempts = 0, run_at = now(), locked_at = null, locked_by = null, updated_at = now()
      where status = 'failed' and (${body.queue ?? null}::text is null or queue = ${body.queue ?? null}) returning id`;
    return json({ requeued: rows.length });
  } catch (e) {
    return errorResponse(e);
  }
}
