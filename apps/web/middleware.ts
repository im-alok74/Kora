import { NextResponse, type NextRequest } from 'next/server';
import { MAX_BODY_BYTES } from './lib/badInput';
import { THEME_SCRIPT } from './lib/themeScript';

/**
 * A request limit in front of every API route, per IP address, when Upstash Redis is configured
 * (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN). Without it this does nothing, and the per-address limits on sign-in still apply.
 * Webhooks and the scheduler are left out: they come from a few known senders and must never be turned away.
 * If Upstash cannot be reached the request goes through. A limiter that fails closed would take the whole site down with it.
 */
const PER_MINUTE = Number(process.env.API_RATE_PER_MINUTE ?? 300);

let lastReport = 0;
/** One error line a minute for each instance, so a limiter outage is visible in the logs and any log alert without a flood. */
function reportProblem(e: unknown) {
  const now = Date.now();
  if (now - lastReport < 60_000) return;
  lastReport = now;
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', event: 'ratelimit_unavailable', where: 'middleware', message: String((e as Error)?.message ?? e).slice(0, 200) }));
}

/**
 * A script policy for the signed-in pages, REPORT-ONLY for now: the browser tells /api/csp-report what it would have blocked, and blocks nothing.
 * Scripts need the per-request nonce (Next.js adds it to its own scripts when the policy is on the request), 'strict-dynamic' lets those load
 * their chunks, and nothing else may run. Switch to enforcing (rename the header) after a week without reports from real use.
 */
async function pageCsp(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const themeHash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(THEME_SCRIPT)))));
  const policy = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'sha256-${themeHash}' 'strict-dynamic'`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'", 'report-uri /api/csp-report',
  ].join('; ');
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy-report-only', policy);   // Next.js reads the nonce from the request's policy
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy-report-only', policy);
  return res;
}

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/')) return await pageCsp(req);
  // A body larger than any real request is refused before the route reads it. (Vercel stops bodies over 4.5 MB itself; other hosts do not.)
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES && !req.nextUrl.pathname.startsWith('/api/webhooks/')) return NextResponse.json({ error: 'That request is too large.' }, { status: 413 });
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
    if (!res.ok) reportProblem(new Error(`Upstash answered ${res.status}`));
    if (res.ok) {
      const n = Number(((await res.json()) as { result?: number }[])[0]?.result ?? 0);
      if (n > PER_MINUTE) return NextResponse.json({ error: 'Too many requests. Slow down and try again in a minute.' }, { status: 429, headers: { 'retry-after': '60' } });
    }
  } catch (e) {
    reportProblem(e);
    /* let the request through */
  }
  return NextResponse.next();
}

export const config = { matcher: ['/api/:path*', '/app/:path*', '/ca/:path*', '/send/:path*'] };
