/**
 * The GST partner (GSP) boundary. Kora never talks to the Invoice Registration Portal directly: it sends the
 * IRP-shaped JSON to a partner and gets back an IRN, acknowledgement and signed QR. Swapping partners is a new
 * implementation of GspClient, and nothing in the invoice code changes.
 *
 * The request and response shapes follow the public IRP e-invoice schema (version 1.1) as I know it. They must be
 * checked against the partner's current documentation and sandbox before any live use.
 */
export interface IrnResult {
  irn: string;
  ackNo: string;
  /** ISO 8601, in UTC. */
  ackDate: string;
  signedInvoice: string;
  signedQr: string;
}

export type GspErrorKind =
  | 'validation'   // the portal rejected the content; resending the same data will not help
  | 'duplicate'    // already registered; `existing` carries the original IRN details
  | 'transient'    // timeout, outage, rate limit; try again later
  | 'auth';        // our credentials with the partner are wrong; an operator must fix it

export class GspError extends Error {
  constructor(
    public kind: GspErrorKind, public code: string, message: string,
    public details: { code: string; message: string }[] = [], public existing?: IrnResult,
  ) {
    super(message);
    this.name = 'GspError';
  }
}
export const isGspError = (e: unknown): e is GspError => e instanceof Error && e.name === 'GspError';

export type CancelReason = '1' | '2' | '3' | '4'; // duplicate, data entry mistake, order cancelled, other

export interface GspClient {
  generateIrn(payload: Record<string, unknown>): Promise<IrnResult>;
  cancelIrn(a: { irn: string; reason: CancelReason; remark: string }): Promise<{ irn: string; cancelDate: string }>;
  /** Looks an IRN up by document, used to recover when a registration succeeded but the answer was lost. */
  getIrnByDocument(a: { sellerGstin: string; docType: 'INV' | 'CRN' | 'DBN'; docNo: string; docDate: string }): Promise<IrnResult | null>;
}

interface NicResponse<T> {
  Status: 0 | 1; ErrorCode?: string; ErrorMessage?: string; Data?: T;
  ErrorDetails?: { ErrorCode: string; ErrorMessage: string }[];
  InfoDtls?: { InfCd: string; Desc: any }[];
}

function toIso(s: string): string {
  // "2026-10-18 14:05:09" is India time on the portal.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return new Date(s).toISOString();
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) - 330 * 60_000).toISOString();
}

/** Talks to a partner that exposes the NIC-style JSON API. Timeouts and 5xx are transient; the portal's own refusals are not. */
export function createHttpGsp(cfg: { baseUrl: string; token?: string; timeoutMs?: number; fetch?: typeof fetch }): GspClient {
  const f = cfg.fetch ?? fetch;
  const base = cfg.baseUrl.replace(/\/$/, '');
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<NicResponse<T>> {
    let res: Response;
    try {
      res = await f(base + path, {
        method, headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw new GspError('transient', 'NETWORK', `The GST portal could not be reached (${(e as Error).message}).`);
    }
    if (res.status === 401 || res.status === 403) throw new GspError('auth', 'AUTH', 'The GST partner refused our credentials.');
    if (res.status === 429 || res.status >= 500) throw new GspError('transient', String(res.status), `The GST portal is not available right now (HTTP ${res.status}).`);
    let json: NicResponse<T>;
    try { json = (await res.json()) as NicResponse<T>; }
    catch { throw new GspError('transient', 'BAD_RESPONSE', 'The GST portal sent a reply we could not read.'); }
    return json;
  }
  const result = (d: any): IrnResult => ({ irn: d.Irn, ackNo: String(d.AckNo), ackDate: toIso(d.AckDt), signedInvoice: d.SignedInvoice ?? '', signedQr: d.SignedQRCode ?? '' });

  return {
    async generateIrn(payload) {
      const r = await call<any>('POST', '/einvoice/generate', payload);
      if (r.Status === 1 && r.Data) return result(r.Data);
      const details = (r.ErrorDetails ?? []).map((d) => ({ code: d.ErrorCode, message: d.ErrorMessage }));
      const code = r.ErrorCode ?? details[0]?.code ?? 'UNKNOWN';
      const dup = r.InfoDtls?.find((i) => i.InfCd === 'DUPIRN');
      if (code === '2150' || dup) {
        throw new GspError('duplicate', '2150', r.ErrorMessage ?? 'Duplicate IRN', details, dup ? result(dup.Desc) : undefined);
      }
      if (['5001', '5002', '503'].includes(code)) throw new GspError('transient', code, r.ErrorMessage ?? 'Portal busy', details);
      throw new GspError('validation', code, r.ErrorMessage ?? details[0]?.message ?? 'The portal rejected the invoice.', details);
    },
    async cancelIrn(a) {
      const r = await call<any>('POST', '/einvoice/cancel', { Irn: a.irn, CnlRsn: a.reason, CnlRem: a.remark });
      if (r.Status === 1 && r.Data) return { irn: r.Data.Irn, cancelDate: toIso(r.Data.CancelDate) };
      throw new GspError('validation', r.ErrorCode ?? 'UNKNOWN', r.ErrorMessage ?? 'The portal refused the cancellation.');
    },
    async getIrnByDocument(a) {
      const q = new URLSearchParams({ gstin: a.sellerGstin, typ: a.docType, no: a.docNo, dt: a.docDate });
      const r = await call<any>('GET', `/einvoice/by-document?${q}`);
      return r.Status === 1 && r.Data ? result(r.Data) : null;
    },
  };
}
