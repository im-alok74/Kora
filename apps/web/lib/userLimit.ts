/**
 * A per-person request limit for signed-in routes. It counts in memory, per server instance, so it costs no database write per request.
 * That stops one person (or one stolen session) from hammering a single instance; it is not a global cap. With Upstash configured the
 * middleware adds a limit per network address across all instances.
 * Ordinary use is far below the limits: a busy screen makes a handful of requests a second at most.
 */
const WINDOW_MS = 60_000;
const GENERAL = Number(process.env.USER_RATE_PER_MINUTE ?? 600);
const HEAVY = Number(process.env.USER_HEAVY_RATE_PER_MINUTE ?? 40);

/** Routes that do a lot of work per call: reports, exports, imports, bulk actions. */
export const isHeavyPath = (path: string) =>
  /^\/api\/(reports|data\/(export|import|import-invoices|tally)|documents\/bulk|parties\/export)/.test(path) || /\/(pdf|html)$/.test(path);

const g = globalThis as unknown as { __koraUserRate?: Map<string, { n: number; reset: number }> };

/** Returns the seconds to wait when this person is over the limit, or 0 to carry on. */
export function userRateCheck(userId: string, path: string, now = Date.now()): number {
  const map = (g.__koraUserRate ??= new Map());
  const heavy = isHeavyPath(path);
  const key = `${heavy ? 'h' : 'g'}:${userId}`;
  const limit = heavy ? HEAVY : GENERAL;
  let e = map.get(key);
  if (!e || e.reset <= now) { e = { n: 0, reset: now + WINDOW_MS }; map.set(key, e); }
  e.n++;
  if (map.size > 5000) for (const [k, v] of map) if (v.reset <= now) map.delete(k);   // keep the table small
  return e.n > limit ? Math.max(1, Math.ceil((e.reset - now) / 1000)) : 0;
}
