import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gstinValid } from '@kora/tax';

/**
 * A stand-in for the GST partner, speaking the NIC-style JSON the real one does. It checks the same rules the
 * Invoice Registration Portal checks, so a payload that passes here is a good (not a proven) candidate for the
 * real portal. It keeps state in memory and is for development, tests and demos only. No live call is ever made.
 *
 * Behaviour can be steered by the buyer's PAN letters (characters 3 to 7 of the buyer GSTIN):
 *   REJEC  the portal says the buyer GSTIN is not active (a permanent rejection)
 *   OUTAG  the portal is down for the first two attempts, then works
 *   DOWNX  the portal is always down
 */
export interface MockGspOptions {
  /** Clock for the 24-hour cancellation window. Tests inject their own. */
  now?: () => Date;
  /** Required bearer token, if any. */
  token?: string;
}

const DOC_NO = /^[A-Z1-9][A-Z0-9/-]{0,15}$/;
const SLABS = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40]);
const UQC = new Set(['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS']);

type Problem = { ErrorCode: string; ErrorMessage: string };

function cents(n: unknown): number { return Math.round(Number(n) * 100); }

/** The portal's content rules. Money is compared in paise so there is no floating point drift. */
export function validateIrpPayload(p: any): Problem[] {
  const out: Problem[] = [];
  const bad = (code: string, msg: string) => out.push({ ErrorCode: code, ErrorMessage: msg });
  if (p?.Version !== '1.1') bad('2000', 'Version must be 1.1.');
  if (p?.TranDtls?.TaxSch !== 'GST') bad('2001', 'TranDtls.TaxSch must be GST.');
  if (!['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'].includes(p?.TranDtls?.SupTyp)) bad('2002', 'TranDtls.SupTyp is not valid.');
  if (!['INV', 'CRN', 'DBN'].includes(p?.DocDtls?.Typ)) bad('2003', 'DocDtls.Typ must be INV, CRN or DBN.');
  if (!DOC_NO.test(String(p?.DocDtls?.No ?? ''))) bad('2004', 'DocDtls.No must be 1 to 16 characters: capital letters, digits, / and - only.');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(p?.DocDtls?.Dt ?? ''))) bad('2005', 'DocDtls.Dt must be dd/mm/yyyy.');
  for (const [k, who] of [['SellerDtls', 'seller'], ['BuyerDtls', 'buyer']] as const) {
    const d = p?.[k] ?? {};
    if (!gstinValid(String(d.Gstin ?? ''))) bad(k === 'SellerDtls' ? '3001' : '3002', `The ${who} GSTIN is not valid.`);
    if (!d.LglNm || String(d.LglNm).length > 100) bad('3003', `The ${who} legal name is required (up to 100 characters).`);
    if (!d.Addr1 || String(d.Addr1).length > 100) bad('3004', `The ${who} address line 1 is required (up to 100 characters).`);
    if (!d.Loc || String(d.Loc).length > 50) bad('3005', `The ${who} location (city) is required.`);
    if (!/^[1-9]\d{5}$/.test(String(d.Pin ?? ''))) bad('3006', `The ${who} pincode must be 6 digits.`);
    if (!/^\d{2}$/.test(String(d.Stcd ?? ''))) bad('3007', `The ${who} state code must be 2 digits.`);
    else if (d.Gstin && String(d.Gstin).slice(0, 2) !== String(d.Stcd)) bad('3008', `The ${who} state code does not match the GSTIN.`);
  }
  if (!/^\d{2}$/.test(String(p?.BuyerDtls?.Pos ?? ''))) bad('3009', 'The buyer place of supply must be a 2-digit state code.');
  const items: any[] = Array.isArray(p?.ItemList) ? p.ItemList : [];
  if (items.length === 0) bad('4000', 'At least one item is required.');
  const intra = p?.SellerDtls?.Stcd && p?.SellerDtls?.Stcd === p?.BuyerDtls?.Pos;
  const sum = { ass: 0, cgst: 0, sgst: 0, igst: 0, ces: 0, tot: 0 };
  items.forEach((it, i) => {
    const at = `Item ${i + 1}`;
    if (!it.PrdDesc) bad('4001', `${at}: description is required.`);
    if (!/^\d{4,8}$/.test(String(it.HsnCd ?? ''))) bad('4002', `${at}: HSN or SAC must be 4 to 8 digits.`);
    if (!SLABS.has(Number(it.GstRt))) bad('4003', `${at}: GST rate ${it.GstRt} is not an allowed slab.`);
    if (!UQC.has(String(it.Unit ?? ''))) bad('4004', `${at}: unit ${it.Unit} is not a valid unit quantity code.`);
    const tot = cents(it.TotAmt), disc = cents(it.Discount ?? 0), ass = cents(it.AssAmt);
    if (ass !== tot - disc) bad('4005', `${at}: taxable value must equal amount minus discount.`);
    const rate = Number(it.GstRt);
    const ig = cents(it.IgstAmt ?? 0), cg = cents(it.CgstAmt ?? 0), sg = cents(it.SgstAmt ?? 0), cs = cents(it.CesAmt ?? 0);
    if (intra && ig !== 0) bad('4006', `${at}: IGST cannot be charged within the same state.`);
    if (!intra && (cg !== 0 || sg !== 0)) bad('4007', `${at}: CGST and SGST cannot be charged between states.`);
    const expectTax = (ass * rate) / 100;
    const got = intra ? cg + sg : ig;
    if (Math.abs(got - expectTax) > 2) bad('4008', `${at}: tax amount does not match the rate (expected about ${(expectTax / 100).toFixed(2)}).`);
    if (cents(it.TotItemVal) !== ass + ig + cg + sg + cs) bad('4009', `${at}: item total must equal taxable value plus taxes.`);
    sum.ass += ass; sum.cgst += cg; sum.sgst += sg; sum.igst += ig; sum.ces += cs; sum.tot += cents(it.TotItemVal);
  });
  const v = p?.ValDtls ?? {};
  // The portal allows a small tolerance on document totals; ours are exact, so a gap here is a real bug on our side.
  const near = (a: number, b: number) => Math.abs(a - b) <= 100;
  if (!near(cents(v.AssVal), sum.ass)) bad('5001', 'ValDtls.AssVal must equal the sum of item taxable values.');
  if (!near(cents(v.CgstVal ?? 0), sum.cgst) || !near(cents(v.SgstVal ?? 0), sum.sgst) || !near(cents(v.IgstVal ?? 0), sum.igst) || !near(cents(v.CesVal ?? 0), sum.ces)) {
    bad('5002', 'ValDtls tax totals must equal the sum of item taxes.');
  }
  const expectInv = sum.tot + cents(v.OthChrg ?? 0) + cents(v.RndOffAmt ?? 0);
  if (!near(cents(v.TotInvVal), expectInv)) bad('5003', 'ValDtls.TotInvVal must equal the item totals plus other charges and round off.');
  if (Math.abs(cents(v.RndOffAmt ?? 0)) > 100) bad('5004', 'Round off cannot be more than Rs 1.');
  if (p?.TranDtls?.RegRev === 'Y') bad('2200', 'Reverse-charge supplies are not supported by this mock.');
  return out;
}

function fyOf(dt: string): string {
  const [, m, y] = dt.split('/').map(Number) as [number, number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The real IRN rule: SHA-256 of seller GSTIN, financial year, document type and number, as 64 hex characters. */
export function computeIrn(sellerGstin: string, docType: string, docNo: string, docDate: string): string {
  return createHash('sha256').update(`${sellerGstin}${fyOf(docDate)}${docType}${docNo}`).digest('hex');
}

interface Registered {
  irn: string; ackNo: number; ackAt: Date; docType: string; docNo: string; docDate: string; sellerGstin: string;
  payload: any; cancelledAt?: Date;
}

const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

export function createMockGspServer(opts: MockGspOptions = {}): { server: Server; reset(): void; registered(): Registered[] } {
  const now = opts.now ?? (() => new Date());
  const byIrn = new Map<string, Registered>();
  const attempts = new Map<string, number>();
  let ack = 100000000000;

  const data = (r: Registered) => ({
    AckNo: r.ackNo, AckDt: ist(r.ackAt), Irn: r.irn, Status: r.cancelledAt ? 'CNL' : 'ACT',
    SignedInvoice: `mock.${Buffer.from(JSON.stringify({ irn: r.irn })).toString('base64url')}.signature`,
    SignedQRCode: `mock.${Buffer.from(JSON.stringify({ SellerGstin: r.sellerGstin, DocNo: r.docNo, DocTyp: r.docType, DocDt: r.docDate, Irn: r.irn })).toString('base64url')}.signature`,
  });
  const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
  const fail = (res: ServerResponse, code: string, message: string, details: Problem[] = [], extra: object = {}) =>
    send(res, 200, { Status: 0, ErrorCode: code, ErrorMessage: message, ErrorDetails: details.length ? details : [{ ErrorCode: code, ErrorMessage: message }], ...extra });

  async function body(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const c of req) { chunks.push(c as Buffer); if (Buffer.concat(chunks).length > 1_000_000) throw new Error('too large'); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; }
  }

  const server = createServer(async (req, res) => {
    try {
      if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return send(res, 401, { error: 'unauthorised' });
      const url = new URL(req.url ?? '/', 'http://x');

      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { status: 'ok' });

      if (req.method === 'POST' && url.pathname === '/einvoice/generate') {
        const p = await body(req);
        if (!p) return send(res, 400, { error: 'bad json' });
        const buyer = String(p?.BuyerDtls?.Gstin ?? '');
        const pan = buyer.slice(2, 7);
        const key = `${p?.SellerDtls?.Gstin}|${p?.DocDtls?.Typ}|${p?.DocDtls?.No}`;
        if (pan === 'DOWNX') return send(res, 503, { error: 'service unavailable' });
        if (pan === 'OUTAG') {
          const n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n);
          if (n <= 2) return send(res, 503, { error: 'service unavailable' });
        }
        const problems = validateIrpPayload(p);
        if (problems.length) return fail(res, problems[0]!.ErrorCode, problems[0]!.ErrorMessage, problems);
        if (pan === 'REJEC') return fail(res, '3029', 'The buyer GSTIN is not active on the GST portal.');
        const irn = computeIrn(p.SellerDtls.Gstin, p.DocDtls.Typ, p.DocDtls.No, p.DocDtls.Dt);
        const existing = byIrn.get(irn);
        if (existing && !existing.cancelledAt) {
          return fail(res, '2150', 'Duplicate IRN', [], { InfoDtls: [{ InfCd: 'DUPIRN', Desc: data(existing) }] });
        }
        const r: Registered = { irn, ackNo: ++ack, ackAt: now(), docType: p.DocDtls.Typ, docNo: p.DocDtls.No, docDate: p.DocDtls.Dt, sellerGstin: p.SellerDtls.Gstin, payload: p };
        byIrn.set(irn, r);
        return send(res, 200, { Status: 1, ErrorCode: '', ErrorMessage: '', Data: data(r) });
      }

      if (req.method === 'POST' && url.pathname === '/einvoice/cancel') {
        const p = await body(req);
        const r = p?.Irn ? byIrn.get(String(p.Irn)) : undefined;
        if (!r) return fail(res, '2148', 'IRN not found.');
        if (r.cancelledAt) return fail(res, '2141', 'The IRN is already cancelled.');
        if (!['1', '2', '3', '4'].includes(String(p.CnlRsn))) return fail(res, '2149', 'Cancel reason must be 1, 2, 3 or 4.');
        if (now().getTime() - r.ackAt.getTime() > 24 * 3600_000) return fail(res, '2142', 'An IRN can be cancelled only within 24 hours of generation.');
        r.cancelledAt = now();
        return send(res, 200, { Status: 1, Data: { Irn: r.irn, CancelDate: ist(r.cancelledAt) } });
      }

      if (req.method === 'GET' && url.pathname === '/einvoice/by-document') {
        const q = url.searchParams;
        const dt = String(q.get('dt'));
        const irn = computeIrn(String(q.get('gstin')), String(q.get('typ')), String(q.get('no')), dt);
        const r = byIrn.get(irn);
        return r ? send(res, 200, { Status: 1, Data: data(r) }) : fail(res, '2148', 'No IRN for this document.');
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });
  return { server, reset: () => { byIrn.clear(); attempts.clear(); }, registered: () => [...byIrn.values()] };
}

export async function startMockGsp(port = 0, opts: MockGspOptions = {}): Promise<{ url: string; close(): Promise<void>; reset(): void; registered(): Registered[] }> {
  const m = createMockGspServer(opts);
  await new Promise<void>((r) => m.server.listen(port, '127.0.0.1', r));
  const addr = m.server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => m.server.close(() => r())), reset: m.reset, registered: m.registered };
}
