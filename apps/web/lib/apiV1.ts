import { authenticateApiKey, type ApiScope, type TenantSession } from '@kora/core';
import type { Sql } from '@kora/db';
import { errorResponse, requireJson, services } from './server';

/**
 * The public API, /api/v1. Every request carries "Authorization: Bearer kora_...". A key belongs to one business and has
 * read or write access. Errors always look like { "error": { "code", "message", "field"? } }.
 */
const WINDOW_MS = 60_000;
const LIMIT = Math.max(1, Number(process.env.API_RATE_LIMIT ?? 120));
// Counted in this server process. With several instances the real ceiling is higher; it exists to stop a runaway loop, not to meter.
const buckets = new Map<string, { start: number; n: number }>();

const body = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const CODES: Record<number, string> = { 400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 415: 'unsupported_media_type', 429: 'rate_limited' };

export const v1Error = (status: number, message: string, extra: { field?: string; code?: string } = {}, headers: Record<string, string> = {}) =>
  body(status, { error: { code: extra.code ?? CODES[status] ?? 'server_error', message, ...(extra.field ? { field: extra.field } : {}) } }, headers);

/** Turns the app's error mapping into the API's error shape, and says "not found" as 404. */
async function fromApp(e: unknown): Promise<Response> {
  const r = errorResponse(e);
  const j = (await r.json()) as { error?: string; field?: string; code?: string };
  const status = r.status === 400 && /not found/i.test(j.error ?? '') ? 404 : r.status;
  return v1Error(status, j.error ?? 'Request failed.', { field: j.field, code: status === 409 ? 'conflict' : undefined });
}

export const created = (data: unknown) => body(201, data);
export const ok = (data: unknown) => body(200, data);

export interface V1Context { t: TenantSession; sql: Sql; req: Request; params: Record<string, string>; scope: ApiScope; appUrl: string }

export function v1Route(opts: { write?: boolean }, handler: (c: V1Context) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      const svc = services();
      const auth = await authenticateApiKey(svc.sql, req.headers.get('authorization'));
      if (!auth) return v1Error(401, 'Send a valid API key as "Authorization: Bearer kora_...".', {}, { 'www-authenticate': 'Bearer' });

      const now = Date.now();
      const b = buckets.get(auth.keyId);
      const bucket = b && now - b.start < WINDOW_MS ? b : { start: now, n: 0 };
      bucket.n++; buckets.set(auth.keyId, bucket);
      const rate = { 'x-ratelimit-limit': String(LIMIT), 'x-ratelimit-remaining': String(Math.max(0, LIMIT - bucket.n)) };
      if (bucket.n > LIMIT) return v1Error(429, `Too many requests. The limit is ${LIMIT} a minute for each key.`, {}, { ...rate, 'retry-after': String(Math.ceil((bucket.start + WINDOW_MS - now) / 1000)) });

      if (opts.write) {
        if (auth.scope !== 'write') return v1Error(403, 'This key is read-only. Make a key with write access to change data.', {}, rate);
        if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return v1Error(415, 'Send the body as JSON with "Content-Type: application/json".', {}, rate);
      }
      const out = await handler({ t: auth.t, sql: svc.sql, req, params: await ctx.params, scope: auth.scope, appUrl: svc.appUrl });
      if (out instanceof Response) { for (const [k, v] of Object.entries(rate)) out.headers.set(k, v); return out; }
      return body(200, out, rate);
    } catch (e) {
      return fromApp(e);
    }
  };
}

/** limit and offset, with sane bounds. */
export function page(req: Request) {
  const q = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(q.get('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(q.get('offset') ?? 0) || 0);
  return { q, limit, offset };
}
void requireJson;
