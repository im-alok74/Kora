import { cookies } from 'next/headers';
import { createSql, type Sql } from '@kora/db';
import { createHttpGsp, createMockGateway, createMockGstinLookup, otpSenderFromEnv, type GspClient, type GstinLookup, type PaymentGateway } from '@kora/adapters';
import {
  createAuth, getEinvoice, getTemplate, getBusiness, getDocument, getParty, isAuthError, isConflictError, isForbidden, isValidationError, listBusinesses, resolveTenant,
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

interface Services { sql: Sql; auth: Auth; gateway: PaymentGateway; gstin: GstinLookup; gsp: GspClient; appUrl: string; gatewaySecret: string }

// One pool and one set of adapters per server process. The web process only queues sends; the worker sends them.
const g = globalThis as unknown as { __kora?: Services };
export function services(): Services {
  if (!g.__kora) {
    const sql = createSql(need('DATABASE_URL'), { max: 10 });
    const auth = createAuth(sql, otpSenderFromEnv(), {
      hmacSecret: need('OTP_HMAC_SECRET'),
      sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
    });
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const gatewayName = process.env.GATEWAY ?? 'mock';
    const gatewaySecret = need('GATEWAY_WEBHOOK_SECRET');
    if (gatewayName !== 'mock') throw new Error(`Unknown GATEWAY "${gatewayName}". Real gateways need an approved account and keys first.`);
    if (process.env.NODE_ENV === 'production' && process.env.KORA_ALLOW_MOCKS !== '1') {
      throw new Error('The mock payment gateway is not allowed in production. Set up a real gateway, or KORA_ALLOW_MOCKS=1 for a staging demo.');
    }
    g.__kora = { sql, auth, gateway: createMockGateway({ secret: gatewaySecret, baseUrl: appUrl }), gstin: createMockGstinLookup(), appUrl, gatewaySecret,
      gsp: createHttpGsp({ baseUrl: need('GSP_URL'), token: process.env.GSP_TOKEN, timeoutMs: Number(process.env.GSP_TIMEOUT_MS ?? 15_000) }) };
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
  if (isAuthError(e)) return json({ error: e.message, code: e.code }, e.code === 'invalid_code' ? 400 : 429);
  if (isForbidden(e)) return json({ error: e.message }, 403);
  if (isValidationError(e)) return json({ error: e.message, field: e.field }, 400);
  if (isTaxError(e)) return json({ error: e.message, code: e.code }, 400);
  if (isConflictError(e)) return json({ error: e.message, code: 'conflict', id: e.documentId, serverRev: e.serverRev }, 409);
  // A malformed id in the URL is "not found", not a server error.
  if ((e as { code?: string })?.code === '22P02') return json({ error: 'Not found.' }, 404);
  if (e instanceof Error && /^Enter a valid/.test(e.message)) return json({ error: e.message }, 400);
  console.error(e);
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
