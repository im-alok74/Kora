import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createAuth, isAuthError, pgRateLimiter, rateLimiterFromEnv, reportLimiterProblem, upstashRateLimiter } from '../src/index.js';
import { createMockOtpSender } from '@kora/adapters';

let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }, 60_000);
afterAll(async () => { await db?.drop(); });

describe('hitCount', () => {
  it('Postgres: counts each hit and allows up to the limit', async () => {
    const l = pgRateLimiter(db.web);
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(await l.hitCount('count:a', 3, 60));
    expect(seen).toEqual([{ allowed: true, count: 1 }, { allowed: true, count: 2 }, { allowed: true, count: 3 }, { allowed: false, count: 4 }]);
    expect(await l.hit('count:b', 1, 60)).toBe(true);
  });

  it('Upstash: reads the count from INCR', async () => {
    let n = 0;
    const f = (async () => ({ ok: true, status: 200, json: async () => [{ result: ++n }, { result: 1 }] })) as unknown as typeof fetch;
    const l = upstashRateLimiter('https://example.upstash.io', 't', f);
    expect(await l.hitCount('k', 2, 60)).toEqual({ allowed: true, count: 1 });
    expect(await l.hitCount('k', 2, 60)).toEqual({ allowed: true, count: 2 });
    expect(await l.hitCount('k', 2, 60)).toEqual({ allowed: false, count: 3 });
  });

  it('falls back to Postgres when Upstash cannot be reached, and never blocks because of it', async () => {
    const l = rateLimiterFromEnv(db.web, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 'x' });
    expect(await l.hitCount('fallback:a', 2, 60)).toEqual({ allowed: true, count: 1 });
    expect(await l.hitCount('fallback:a', 2, 60)).toEqual({ allowed: true, count: 2 });
    expect((await l.hitCount('fallback:a', 2, 60)).allowed).toBe(false);
  });
});

describe('reportLimiterProblem', () => {
  it('writes one error line a minute, not one per request', () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (s: unknown) => { lines.push(String(s)); };
    try {
      const t0 = Date.now() + 3_600_000;
      reportLimiterProblem('test', new Error('down'), t0);
      reportLimiterProblem('test', new Error('down'), t0 + 5_000);
      reportLimiterProblem('test', new Error('still down'), t0 + 61_000);
    } finally { console.error = orig; }
    const ours = lines.filter((l) => l.includes('ratelimit_unavailable'));
    expect(ours).toHaveLength(2);
    expect(JSON.parse(ours[0]!)).toMatchObject({ level: 'error', event: 'ratelimit_unavailable', where: 'test', message: 'down' });
  });
});

describe('sign-up limits', () => {
  it('one address can be tried five times in 15 minutes, from any network', async () => {
    const auth = createAuth(db.web, createMockOtpSender(() => {}), { hmacSecret: 'x'.repeat(40), limiter: pgRateLimiter(db.web) });
    const attempt = (ip: string) => auth.signUp({ identifier: 'probe@example.test', password: 'a-long-password', name: 'Probe' }, { ip });
    await attempt('192.0.2.1');
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      try { await attempt(`192.0.2.${10 + i}`); } catch (e) { codes.push(isAuthError(e) ? e.code : 'other'); }
    }
    // the first call made the account, calls 2 to 5 are told it exists, the sixth and later are limited
    expect(codes).toEqual(['exists', 'exists', 'exists', 'exists', 'rate_limited', 'rate_limited']);
  });
});
