import { headers } from 'next/headers';
import { reportLimiterProblem } from '@kora/core';
import { services } from './server';

/**
 * A per-address request limit for the routes anyone on the internet can reach: the public invoice page and its PDF, the customer
 * portal and the GSTIN checks. It counts in the shared limiter (Upstash when configured, otherwise Postgres), so it works on every
 * server instance, and it does not need Upstash. Returns an answer to send back when the limit is passed, or null to carry on.
 * If the limiter itself fails the request goes through and the fault is reported (once a minute), so a limiter outage never
 * takes the site down.
 */
export async function publicLimit(bucket: string, perMinute: number, as: 'text' | 'json' = 'json'): Promise<Response | null> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
    const { allowed } = await services().limiter.hitCount(`pub:${bucket}:${ip}`, perMinute, 60);
    if (allowed) return null;
    const message = 'Too many requests. Wait a minute and try again.';
    const base = { 'retry-after': '60', 'cache-control': 'no-store' };
    return as === 'text'
      ? new Response(message, { status: 429, headers: { ...base, 'content-type': 'text/plain; charset=utf-8' } })
      : Response.json({ error: message }, { status: 429, headers: base });
  } catch (e) {
    reportLimiterProblem(`public:${bucket}`, e);
    return null;
  }
}
