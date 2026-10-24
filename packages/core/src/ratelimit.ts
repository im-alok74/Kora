import type { Sql } from '@kora/db';
import { log, reportError } from './observe.js';

/**
 * A fixed-window request limiter. hit() counts one request for a key and says whether it is still within the limit.
 * hitCount() does the same and also says how many requests the window holds now, for "remaining" headers.
 * Postgres is the default, so a single server and a set of servers both work with nothing extra to run.
 * Upstash Redis (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) is used when present, which is faster under heavy traffic.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  hitCount(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number }>;
}

export function pgRateLimiter(sql: Sql): RateLimiter {
  const hitCount: RateLimiter['hitCount'] = async (key, limit, windowSeconds) => {
    const [r] = await sql`
      with ins as (insert into rate_event (key) values (${key}))
      select count(*)::int as n from rate_event where key = ${key} and at > now() - ${windowSeconds + ' seconds'}::interval`;
    // The row just inserted is not visible to the count in the same statement, so n is the number of earlier requests.
    if (Math.random() < 0.01) await sql`delete from rate_event where at < now() - interval '1 day'`.catch(() => {});
    const earlier = r!.n as number;
    return { allowed: earlier < limit, count: earlier + 1 };
  };
  return { hitCount, hit: async (k, l, w) => (await hitCount(k, l, w)).allowed };
}

export function upstashRateLimiter(url: string, token: string, fetchImpl: typeof fetch = fetch): RateLimiter {
  const base = url.replace(/\/+$/, '');
  const hitCount: RateLimiter['hitCount'] = async (key, limit, windowSeconds) => {
    const slot = Math.floor(Date.now() / 1000 / windowSeconds);
    const k = `rl:${key}:${slot}`;
    const res = await fetchImpl(`${base}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['EXPIRE', k, String(windowSeconds + 5)]]),
    });
    if (!res.ok) throw new Error(`Upstash answered ${res.status}`);
    const out = (await res.json()) as { result?: number }[];
    const count = Number(out[0]?.result ?? 0);
    return { allowed: count <= limit, count };
  };
  return { hitCount, hit: async (k, l, w) => (await hitCount(k, l, w)).allowed };
}

let lastReported = 0;
/**
 * A limiter that cannot do its job is a fault someone must hear about, but it must not take the site down, so requests go on.
 * One error line and one Sentry event a minute for each process, so an outage does not flood either.
 */
export function reportLimiterProblem(where: string, e: unknown, now = Date.now()): void {
  if (now - lastReported < 60_000) return;
  lastReported = now;
  const message = (e as Error)?.message ?? String(e);
  log('error', 'ratelimit_unavailable', { where, message });
  void reportError(new Error(`The request limiter is not working (${where}): ${message}`), { where });
}

/** Upstash when configured, Postgres otherwise. If Upstash is unreachable the request is counted in Postgres instead, never blocked, and the fault is reported. */
export function rateLimiterFromEnv(sql: Sql, env: Record<string, string | undefined> = process.env): RateLimiter {
  const pg = pgRateLimiter(sql);
  const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return pg;
  const up = upstashRateLimiter(url, token);
  const hitCount: RateLimiter['hitCount'] = (k, l, w) => up.hitCount(k, l, w).catch((e) => { reportLimiterProblem('upstash', e); return pg.hitCount(k, l, w); });
  return { hitCount, hit: async (k, l, w) => (await hitCount(k, l, w)).allowed };
}
