import { cookies } from 'next/headers';
import type { Sql } from '@kora/db';
import { listFirms, resolveFirm, type FirmSession } from '@kora/core';
import { currentUserId, errorResponse, json, requireJson, services, tooManyRequests } from './server';

const FIRM_COOKIE = 'kora_firm';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wraps a route for the CA firm side: checks sign-in, then membership of the firm named by the x-firm-id header or the kora_firm cookie
 * (the person's first firm when neither is set). Same shape as tenantRoute, but the session is a firm, never a client's business.
 */
export function firmRoute(handler: (a: { s: FirmSession; req: Request; sql: Sql }) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const bad = requireJson(req);
        if (bad) return bad;
      }
      const userId = await currentUserId();
      if (!userId) return json({ error: 'Sign in first.' }, 401);
      const slow = tooManyRequests(userId, req);
      if (slow) return slow;
      const { sql } = services();
      // A firm named in the x-firm-id header is exact: not a firm id is a 400, not one of yours is a 403. Never a silent fallback to another firm.
      // The kora_firm cookie is only a remembered choice, so a stale one (a firm the person left) falls back to their first firm.
      const header = req.headers.get('x-firm-id');
      if (header !== null && !UUID.test(header)) return json({ error: 'The x-firm-id header is not a firm id.' }, 400);
      const mine = await listFirms(sql, userId);
      const cookie = (await cookies()).get(FIRM_COOKIE)?.value ?? '';
      const firmId = header ?? (UUID.test(cookie) && mine.some((f) => f.firmId === cookie) ? cookie : mine[0]?.firmId);
      if (!firmId) return json({ error: 'Set up your firm first.', code: 'no_firm' }, 400);
      const out = await handler({ s: await resolveFirm(sql, userId, firmId), req, sql });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
