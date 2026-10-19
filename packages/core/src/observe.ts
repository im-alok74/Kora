/**
 * Logging and error reporting with no extra services required. Logs are one JSON object per line on stdout, which every host collects.
 * If SENTRY_DSN is set, errors are also sent to Sentry through its HTTP envelope endpoint (no SDK, so nothing to bundle).
 * Secrets, cookies and one-time codes are never put in a log line: callers pass plain facts, and reportError strips the rest.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const min = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
  if (ORDER[level] < (ORDER[min] ?? 20)) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export interface SentryTarget { endpoint: string; authHeader: string }

/** https://KEY@oXXXX.ingest.sentry.io/PROJECT becomes the envelope URL and the auth header Sentry expects. */
export function parseSentryDsn(dsn: string): SentryTarget | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, '');
    if (!u.username || !project) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${project}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_client=kora/1.0, sentry_key=${u.username}`,
    };
  } catch { return null; }
}

const SECRET_KEYS = /pass|secret|token|authorization|cookie|key|otp|code|dsn/i;
function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[removed]' : scrub(x, depth + 1)]));
  return typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}...` : v;
}

/** The body of a Sentry envelope for one error event. */
export function sentryEnvelope(e: unknown, ctx: Record<string, unknown>, dsn: string, now = new Date(), id = crypto.randomUUID().replace(/-/g, '')): string {
  const err = e instanceof Error ? e : new Error(String(e));
  const event = {
    event_id: id, timestamp: now.getTime() / 1000, platform: 'node', level: 'error', environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    server_name: process.env.VERCEL_URL ?? undefined,
    exception: { values: [{ type: err.name, value: err.message.slice(0, 500), stacktrace: { frames: (err.stack ?? '').split('\n').slice(1, 30).reverse().map((l) => ({ filename: l.trim() })) } }] },
    extra: scrub(ctx),
  };
  return [JSON.stringify({ event_id: id, sent_at: now.toISOString(), dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
}

/** Logs the error, and sends it to Sentry if configured. Never throws, never waits longer than a few seconds. */
export async function reportError(e: unknown, ctx: Record<string, unknown> = {}, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const err = e instanceof Error ? e : new Error(String(e));
  log('error', ctx.event ? String(ctx.event) : 'error', { message: err.message, name: err.name, ...(scrub(ctx) as Record<string, unknown>) });
  const dsn = env.SENTRY_DSN;
  const target = dsn ? parseSentryDsn(dsn) : null;
  if (!dsn || !target) return;
  try {
    await fetchImpl(target.endpoint, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': target.authHeader }, body: sentryEnvelope(err, ctx, dsn), signal: AbortSignal.timeout(4000) });
  } catch { /* reporting must never break the request */ }
}
