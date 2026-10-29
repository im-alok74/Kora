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
      const asked = req.headers.get('x-firm-id') ?? (await cookies()).get(FIRM_COOKIE)?.value ?? '';
      const firmId = UUID.test(asked) ? asked : (await listFirms(sql, userId))[0]?.firmId;
      if (!firmId) return json({ error: 'Set up your firm first.', code: 'no_firm' }, 400);
      const out = await handler({ s: await resolveFirm(sql, userId, firmId), req, sql });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
