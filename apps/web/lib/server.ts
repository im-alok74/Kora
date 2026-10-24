import { cookies } from 'next/headers';
import { createSql, type Sql } from '@kora/db';
import { createLazyGsp, createMockGateway, createRazorpayGateway, createMockGstinLookup, otpSenderFromEnv, type GspClient, type GstinLookup, type PaymentGateway } from '@kora/adapters';
import {
  createAuth, rateLimiterFromEnv, reportError, type RequestInfo, getEinvoice, getTemplate, getBusiness, getDocument, getParty, isAuthError, isConflictError, isForbidden, isValidationError, listBusinesses, resolveTenant,
  type Auth, type TenantSession,
} from '@kora/core';
import { isTaxError } from '@kora/tax';
import { qrDataUrl, upiBlockFor } from '@kora/pdf';

export const SESSION_COOKIE = 'kora_session';
export const BUSINESS_COOKIE = 'kora_business';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

interface Services { sql: Sql; auth: Auth; limiter: import('@kora/core').RateLimiter; gateway: PaymentGateway; gstin: GstinLookup; gsp: GspClient; appUrl: string; gatewaySecret: string }

// One pool and one set of adapters per server process. The web process only queues sends; the worker sends them.
const g = globalThis as unknown as { __kora?: Services };
export function services(): Services {
  if (!g.__kora) {
    const sql = createSql(need('DATABASE_URL'), { max: Number(process.env.DB_POOL_MAX ?? 10) });
    const limiter = rateLimiterFromEnv(sql);
    const auth = createAuth(sql, otpSenderFromEnv(), {
      hmacSecret: need('OTP_HMAC_SECRET'), limiter,
      sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
      // Staging demo only. It needs KORA_ALLOW_MOCKS=1 as well, and lets anyone sign in as any number.
      fixedCode: process.env.KORA_ALLOW_MOCKS === '1' ? process.env.DEMO_FIXED_OTP || undefined : undefined,
    });
    // On Vercel, the platform sets the production host; an explicit APP_URL (a custom domain) always wins.
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const appUrl = process.env.APP_URL ?? (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000');
    const gatewayName = process.env.GATEWAY ?? 'mock';
    let gateway: PaymentGateway;
    let gatewaySecret = process.env.GATEWAY_WEBHOOK_SECRET ?? '';
    if (gatewayName === 'razorpay') {
      gatewaySecret = need('RAZORPAY_WEBHOOK_SECRET');
      gateway = createRazorpayGateway({ keyId: need('RAZORPAY_KEY_ID'), keySecret: need('RAZORPAY_KEY_SECRET'), webhookSecret: gatewaySecret, callbackUrl: `${appUrl}/pay/thanks` });
    } else if (gatewayName === 'mock') {
      gatewaySecret = need('GATEWAY_WEBHOOK_SECRET');
      if (process.env.NODE_ENV === 'production' && process.env.KORA_ALLOW_MOCKS !== '1') {
        throw new Error('The mock payment gateway is not allowed in production. Set GATEWAY=razorpay with its keys, or KORA_ALLOW_MOCKS=1 for a staging demo.');
      }
      gateway = createMockGateway({ secret: gatewaySecret, baseUrl: appUrl });
    } else {
      throw new Error(`Unknown GATEWAY "${gatewayName}". Use mock or razorpay.`);
    }
    g.__kora = { sql, auth, limiter, gateway, gstin: createMockGstinLookup(), appUrl, gatewaySecret,
      // Built on first use, so a missing GSP_URL only affects e-invoice and e-way bill calls.
      gsp: createLazyGsp() };
  }
  return g.__kora;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** State-changing requests must be JSON. A cross-site form post cannot send that without a CORS preflight. */
export function requireJson(req: Request): Response | null {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return json({ error: 'Content-Type must be application/json.' }, 415);
  return null;
}

export async function readJson<T = Record<string, any>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

/** Where a request came from: the first address in x-forwarded-for (set by the host), and the browser's description of itself. */
export function requestInfo(req: Request): RequestInfo {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return { ip: fwd || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') };
}

export function sessionCookie(token: string) {
  const days = Number(process.env.SESSION_TTL_DAYS ?? 30);
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${days * 86400}`, process.env.NODE_ENV === 'production' ? 'Secure' : ''].filter(Boolean).join('; ');
}

export async function currentSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Wraps a route that belongs to the signed-in person rather than to one business: sessions, security, sign-in methods. */
export function userRoute(handler: (a: { userId: string; token: string; req: Request; params: Record<string, string>; svc: Services }) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const bad = requireJson(req);
        if (bad) return bad;
      }
      const token = await currentSessionToken();
      const userId = await currentUserId();
      if (!userId || !token) return json({ error: 'Sign in first.' }, 401);
      const out = await handler({ userId, token, req, params: await ctx.params, svc: services() });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await services().auth.getSession(token))?.userId ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** Signed-in user plus verified membership of the active business (cookie, or x-business-id for scripts). */
export async function requireTenant(req: Request): Promise<TenantSession | Response> {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Sign in first.' }, 401);
  const asked = req.headers.get('x-business-id') ?? (await cookies()).get(BUSINESS_COOKIE)?.value ?? '';
  try {
    if (isUuid(asked)) {
      try { return await resolveTenant(services().sql, userId, asked); }
      catch (e) { if (!isForbidden(e) || req.headers.get('x-business-id')) throw e; /* stale cookie: fall through */ }
    }
    // No (valid) choice yet: use the user's first business, so a one-business user never has to pick.
    const mine = await listBusinesses(services().sql, userId);
    if (!mine[0]) return json({ error: 'Set up a business first.', code: 'no_business' }, 400);
    return await resolveTenant(services().sql, userId, mine[0].businessId);
  } catch (e) {
    if (isForbidden(e)) return json({ error: 'You do not belong to that business.' }, 403);
    throw e;
  }
}

export function errorResponse(e: unknown): Response {
  if (isAuthError(e)) return json({ error: e.message, code: e.code }, e.code === 'bad_credentials' ? 401 : ['invalid_code', 'weak_password', 'exists'].includes(e.code) ? 400 : 429);
  if (isForbidden(e)) return json({ error: e.message }, 403);
  if (isValidationError(e)) return json({ error: e.message, field: e.field }, 400);
  if (isTaxError(e)) return json({ error: e.message, code: e.code }, 400);
  if (isConflictError(e)) return json({ error: e.message, code: 'conflict', id: e.documentId, serverRev: e.serverRev }, 409);
  // A malformed id in the URL is "not found", not a server error.
  if ((e as { code?: string })?.code === '22P02') return json({ error: 'Not found.' }, 404);
  if (e instanceof Error && /^Enter a valid/.test(e.message)) return json({ error: e.message }, 400);
  void reportError(e, { event: 'request_error' });
  return json({ error: 'Something went wrong on our side. Try again.' }, 500);
}

type Params = Record<string, string>;
type Handler = (a: { t: TenantSession; req: Request; params: Params; sql: Sql; svc: Services }) => Promise<unknown>;

/**
 * Wraps a tenant route: checks sign-in and membership, requires JSON on writes, maps errors.
 * A handler returns a plain object (sent as JSON) or a Response.
 */
export function tenantRoute(handler: Handler) {
  return async (req: Request, ctx: { params: Promise<Params> }) => {
    try {
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const bad = requireJson(req);
        if (bad) return bad;
      }
      const t = await requireTenant(req);
      if (t instanceof Response) return t;
      const svc = services();
      const out = await handler({ t, req, params: await ctx.params, sql: svc.sql, svc });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const RECEIVABLE = ['tax_invoice', 'bill_of_supply', 'debit_note'];

/** Adds the UPI QR for what is still due, when the supplier has a UPI address and something is owed. */
export async function withUpi<T extends { doc: Record<string, any>; supplier: Record<string, any> }>(input: T) {
  const d = input.doc;
  const outstanding = d.status === 'issued' && RECEIVABLE.includes(d.doc_type)
    ? BigInt(d.grand_total_paise) - BigInt(d.amount_settled_paise ?? 0) : 0n;
  const upi = await upiBlockFor({
    vpa: input.supplier.upi_vpa, name: input.supplier.trade_name || input.supplier.legal_name, outstandingPaise: outstanding, number: String(d.number ?? ''),
  });
  return { ...input, upi };
}

/** The registered e-invoice details and QR image for the page and PDF. */
export async function irnBlock(e: { irn: string; ack_no: string; ack_date: string | Date; signed_qr: string } | null | undefined) {
  if (!e?.irn) return null;
  return { irn: e.irn, ackNo: String(e.ack_no), ackDate: new Date(e.ack_date).toISOString().slice(0, 10), qrDataUrl: e.signed_qr ? await qrDataUrl(e.signed_qr) : undefined };
}

/** Everything the renderer needs for a document, whether draft or issued. */
export async function renderInputFor(sql: Sql, t: TenantSession, id: string) {
  const full = await getDocument(sql, t, id);
  if (!full) return null;
  const d = full.document as Record<string, any>;
  const supplier = d.supplier_snapshot ?? (await getBusiness(sql, t));
  let recipient = d.recipient_snapshot ?? null;
  if (!recipient && d.party_id) recipient = await getParty(sql, t, d.party_id);
  const ev = d.status === 'draft' ? null : (await getEinvoice(sql, t, id)).current;
  return { ...(await withUpi({ doc: d, lines: full.lines as Record<string, any>[], supplier, recipient, template: await getTemplate(sql, t) })), irn: ev?.status === 'registered' ? await irnBlock(ev as never) : null };
}
