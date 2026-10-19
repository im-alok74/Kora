import type { Sql } from '@kora/db';

/**
 * A fixed-window request limiter. hit() counts one request for a key and says whether it is still within the limit.
 * Postgres is the default, so a single server and a set of servers both work with nothing extra to run.
 * Upstash Redis (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) is used when present, which is faster under heavy traffic.
 */
export interface RateLimiter { hit(key: string, limit: number, windowSeconds: number): Promise<boolean> }

export function pgRateLimiter(sql: Sql): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const [r] = await sql`
        with ins as (insert into rate_event (key) values (${key}))
        select count(*)::int as n from rate_event where key = ${key} and at > now() - ${windowSeconds + ' seconds'}::interval`;
      // The row just inserted is not visible to the count in the same statement, so n is the number of earlier requests.
      if (Math.random() < 0.01) await sql`delete from rate_event where at < now() - interval '1 day'`.catch(() => {});
      return (r!.n as number) < limit;
    },
  };
}

export function upstashRateLimiter(url: string, token: string, fetchImpl: typeof fetch = fetch): RateLimiter {
  const base = url.replace(/\/+$/, '');
  return {
    async hit(key, limit, windowSeconds) {
      const slot = Math.floor(Date.now() / 1000 / windowSeconds);
      const k = `rl:${key}:${slot}`;
      const res = await fetchImpl(`${base}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify([['INCR', k], ['EXPIRE', k, String(windowSeconds + 5)]]),
      });
      if (!res.ok) throw new Error(`Upstash answered ${res.status}`);
      const out = (await res.json()) as { result?: number }[];
      return Number(out[0]?.result ?? 0) <= limit;
    },
  };
}

/** Upstash when configured, Postgres otherwise. If Upstash is unreachable the request is allowed through to Postgres, never blocked. */
export function rateLimiterFromEnv(sql: Sql, env: Record<string, string | undefined> = process.env): RateLimiter {
  const pg = pgRateLimiter(sql);
  const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return pg;
  const up = upstashRateLimiter(url, token);
  return { hit: (k, l, w) => up.hit(k, l, w).catch(() => pg.hit(k, l, w)) };
}
