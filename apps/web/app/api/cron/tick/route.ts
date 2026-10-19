import { timingSafeEqual } from 'node:crypto';
import { createHandlers, runTick } from '@kora/core';
import { messengerFromEnv } from '@kora/adapters';
import { errorResponse, json, services } from '../../../../lib/server';

// Vercel allows up to 60 seconds on the free plan. Stay inside it.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Runs one pass of the background work (due reminders, due recurring invoices, queued messages, e-invoices and webhooks).
 * For hosts with no always-on worker: a scheduler calls this with `Authorization: Bearer <CRON_SECRET>`. Vercel Cron does so
 * by itself when CRON_SECRET is set. Without that secret the route refuses every call, so it is never open by accident.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return json({ error: 'The background tick is not configured. Set CRON_SECRET (16 or more characters).' }, 503);
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!same(given, secret)) return json({ error: 'Not allowed.' }, 401);
  try {
    const { sql, gsp, appUrl } = services();
    const handlers = createHandlers(sql, { messenger: messengerFromEnv(), gsp, appUrl });
    return json({ ok: true, ...(await runTick(sql, handlers, { worker: 'cron-web', budgetMs: 40_000 })) });
  } catch (e) {
    return errorResponse(e);
  }
}
