import { NextResponse, type NextRequest } from 'next/server';

/**
 * A request limit in front of every API route, per IP address, when Upstash Redis is configured
 * (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN). Without it this does nothing, and the per-address limits on sign-in still apply.
 * Webhooks and the scheduler are left out: they come from a few known senders and must never be turned away.
 * If Upstash cannot be reached the request goes through. A limiter that fails closed would take the whole site down with it.
 */
const PER_MINUTE = Number(process.env.API_RATE_PER_MINUTE ?? 300);

export async function middleware(req: NextRequest) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p.startsWith('/api/webhooks/') || p.startsWith('/api/cron/') || p === '/api/health') return NextResponse.next();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const key = `ip:${ip}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, '70']]), signal: AbortSignal.timeout(800),
    });
    if (res.ok) {
      const n = Number(((await res.json()) as { result?: number }[])[0]?.result ?? 0);
      if (n > PER_MINUTE) return NextResponse.json({ error: 'Too many requests. Slow down and try again in a minute.' }, { status: 429, headers: { 'retry-after': '60' } });
    }
  } catch { /* let the request through */ }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
