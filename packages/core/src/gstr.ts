import { rupees } from './einvoice.js';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

type Row = Record<string, any>;

/**
 * GSTR-1 data for one month, in the shape of the GST offline tool's JSON, plus a reconciliation against the ledger.
 *
 * Section names and field names follow the GSTR-1 JSON schema as I know it. Check the output with the GST
 * offline utility before filing: Kora prepares the data, the owner remains responsible for the return.
 */
const B2CL_LIMIT = 250_000_00n; // Rs 2.5 lakh, in paise

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ddmmyyyy = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}-${m}-${y}`; };
const R = (n: bigint) => rupees(n.toString());

interface Agg { txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint }
const zero = (): Agg => ({ txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n });
const add = (a: Agg, l: Row, sign = 1n) => {
  a.txval += sign * BigInt(l.taxable_paise); a.iamt += sign * BigInt(l.igst_paise); a.camt += sign * BigInt(l.cgst_paise);
  a.samt += sign * BigInt(l.sgst_paise); a.csamt += sign * BigInt(l.cess_paise);
};
const det = (rt: number, a: Agg, opts: { noCgst?: boolean } = {}) => ({
  rt, txval: R(a.txval), iamt: R(a.iamt), ...(opts.noCgst ? {} : { camt: R(a.camt), samt: R(a.samt) }), csamt: R(a.csamt),
});

export function periodBounds(period: string): { from: string; to: string; fp: string } {
  const m = MONTH.exec(period);
  if (!m) throw new ValidationError('Choose a month as YYYY-MM.', 'period');
  const y = Number(m[1]), mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  return { from: `${period}-01`, to: next, fp: `${m[2]}${m[1]}` };
}

async function load(sql: Sql, t: TenantSession, period: string) {
  const b = periodBounds(period);
  return inTenant(sql, t, 'report.export', async (tx) => {
    const [biz] = await tx`select gstin, state_code, legal_name from business where id = ${t.businessId}`;
    const docs = await tx`
      select d.id, d.doc_type, d.status, d.number, d.doc_date::text as doc_date, d.place_of_supply, d.reverse_charge, d.grand_total_paise, d.taxable_paise,
             d.original_document_id, coalesce(d.recipient_snapshot->>'gstin', null) as buyer_gstin, d.recipient_snapshot->>'state_code' as buyer_state,
             d.series_id, d.supplier_snapshot->>'state_code' as supplier_state, p.gstin as party_gstin
        from document d left join party p on p.id = d.party_id
       where d.status in ('issued', 'cancelled') and d.doc_date >= ${b.from}::date and d.doc_date < ${b.to}::date
         and d.doc_type in ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')
       order by d.doc_date, d.number`;
    const ids = docs.map((d) => d.id as string);
    const lines = ids.length ? await tx`select * from document_line where document_id in ${tx(ids)} order by document_id, position` : [];
    // A note's recipient is its original's recipient.
    return { biz: biz as Row, docs: docs as Row[], lines: lines as Row[], bounds: b };
  });
}

export async function gstr1(sql: Sql, t: TenantSession, period: string) {
  const { biz, docs, lines, bounds } = await load(sql, t, period);
  const linesBy = new Map<string, Row[]>();
  for (const l of lines) { const a = linesBy.get(l.document_id as string) ?? []; a.push(l); linesBy.set(l.document_id as string, a); }
  const warnings: string[] = [];
  if (!biz.gstin) warnings.push('The business has no GSTIN, so this file cannot be used for GSTR-1.');

  const b2b = new Map<string, Row[]>();
  const b2cl = new Map<string, Row[]>();
  const b2cs = new Map<string, { sply: string; pos: string; rt: number; a: Agg }>();
  const cdnr = new Map<string, Row[]>();
  const cdnur: Row[] = [];
  const nilBuckets = new Map<string, { expt: bigint; nil: bigint; ngsup: bigint }>();
  const hsn = new Map<string, { hsn: string; desc: string; uqc: string; rt: number; qty: number; val: bigint; a: Agg }>();
  const issued = new Map<string, { type: string; nums: string[]; cancelled: number }>();
  let ledgerTaxable = 0n;

  const rateGroups = (ls: Row[]) => {
    const m = new Map<number, Agg>();
    for (const l of ls) { if (l.tax_rate_bp === 0) continue; const a = m.get(l.tax_rate_bp) ?? zero(); add(a, l); m.set(l.tax_rate_bp, a); }
    return [...m.entries()].sort((x, y) => x[0] - y[0]);
  };
  const items = (ls: Row[], opts: { noCgst?: boolean } = {}) => rateGroups(ls).map(([rt, a], i) => ({ num: i + 1, itm_det: det(rt / 100, a, opts) }));
  const nilBucket = (inter: boolean, b2bSale: boolean) => {
    const k = `${inter ? 'INTR' : 'INTRA'}${b2bSale ? 'B2B' : 'B2C'}`;
    const x = nilBuckets.get(k) ?? { expt: 0n, nil: 0n, ngsup: 0n }; nilBuckets.set(k, x); return x;
  };
  const originalBuyer = new Map<string, { gstin: string | null; state: string | null }>();
  for (const d of docs) if (['tax_invoice', 'bill_of_supply'].includes(d.doc_type)) originalBuyer.set(d.id, { gstin: d.buyer_gstin, state: d.buyer_state });

  for (const d of docs) {
    // numbering summary counts every issued number, cancelled ones included
    const label = d.doc_type === 'credit_note' ? 'Credit Note' : d.doc_type === 'debit_note' ? 'Debit Note' : 'Invoices for outward supply';
    const series = `${label}|${String(d.number).replace(/\d+$/, '')}`;
    const s = issued.get(series) ?? { type: label, nums: [], cancelled: 0 }; issued.set(series, s);
    s.nums.push(d.number); if (d.status === 'cancelled') s.cancelled++;
    if (d.status === 'cancelled') continue;

    const ls = linesBy.get(d.id) ?? [];
    const inter = d.place_of_supply !== (d.supplier_state ?? biz.state_code);
    const isNote = d.doc_type === 'credit_note' || d.doc_type === 'debit_note';
    const sign = d.doc_type === 'credit_note' ? -1n : 1n;
    const orig = isNote ? originalBuyer.get(d.original_document_id as string) : null;
    const buyerGstin = (isNote ? (orig?.gstin ?? d.buyer_gstin) : d.buyer_gstin) as string | null;
    const registered = !!buyerGstin;
    ledgerTaxable += sign * BigInt(d.taxable_paise);

    if (d.doc_type === 'bill_of_supply') {
      const nb = nilBucket(inter, registered);
      for (const l of ls) nb.expt += BigInt(l.taxable_paise);
      continue;
    }
    // zero-rated lines of a tax invoice are reported as nil-rated
    const taxed = ls.filter((l) => l.tax_rate_bp > 0);
    for (const l of ls.filter((x) => x.tax_rate_bp === 0)) { nilBucket(inter, registered).nil += sign * BigInt(l.taxable_paise); }

    const rchrg = d.reverse_charge ? 'Y' : 'N';
    if (!isNote) {
      for (const l of ls.filter((x) => x.hsn_sac)) {
        const key = `${l.hsn_sac}|${l.unit}|${l.tax_rate_bp}`;
        const h = hsn.get(key) ?? { hsn: l.hsn_sac, desc: String(l.item_name).slice(0, 30), uqc: l.unit, rt: l.tax_rate_bp / 100, qty: 0, val: 0n, a: zero() };
        h.qty += Number(l.quantity); h.val += BigInt(l.line_total_paise); add(h.a, l); hsn.set(key, h);
      }
    }
    if (taxed.length === 0) continue;

    if (isNote) {
      const note = { ntty: d.doc_type === 'credit_note' ? 'C' : 'D', nt_num: d.number, nt_dt: ddmmyyyy(d.doc_date), val: R(BigInt(d.grand_total_paise)), pos: d.place_of_supply, rchrg, inv_typ: 'R', itms: items(taxed, { noCgst: false }) };
      if (registered) { const a = cdnr.get(buyerGstin!) ?? []; a.push(note); cdnr.set(buyerGstin!, a); }
      else if (inter && BigInt(d.grand_total_paise) > B2CL_LIMIT) cdnur.push({ typ: 'B2CL', ...note, inv_typ: undefined });
      else addB2cs(d, taxed, inter, sign);
      continue;
    }
    if (registered) {
      const inv = { inum: d.number, idt: ddmmyyyy(d.doc_date), val: R(BigInt(d.grand_total_paise)), pos: d.place_of_supply, rchrg, inv_typ: 'R', itms: items(taxed) };
      const a = b2b.get(buyerGstin!) ?? []; a.push(inv); b2b.set(buyerGstin!, a);
    } else if (inter && BigInt(d.grand_total_paise) > B2CL_LIMIT) {
      const inv = { inum: d.number, idt: ddmmyyyy(d.doc_date), val: R(BigInt(d.grand_total_paise)), itms: items(taxed, { noCgst: true }) };
      const a = b2cl.get(d.place_of_supply) ?? []; a.push(inv); b2cl.set(d.place_of_supply, a);
    } else addB2cs(d, taxed, inter, 1n);
  }
  function addB2cs(d: Row, taxed: Row[], inter: boolean, sign: bigint) {
    for (const l of taxed) {
      const sply = inter ? 'INTER' : 'INTRA';
      const key = `${sply}|${d.place_of_supply}|${l.tax_rate_bp}`;
      const x = b2cs.get(key) ?? { sply, pos: d.place_of_supply, rt: l.tax_rate_bp / 100, a: zero() }; add(x.a, l, sign); b2cs.set(key, x);
    }
  }

  const docDet = [...issued.values()].reduce<Record<string, Row>>((m, s, i) => {
    const sorted = [...s.nums].sort();
    const entry = m[s.type] ?? { doc_num: Object.keys(m).length + 1, doc_typ: s.type, docs: [] };
    entry.docs.push({ num: entry.docs.length + 1, from: sorted[0], to: sorted[sorted.length - 1], totnum: s.nums.length, cancel: s.cancelled, net_issue: s.nums.length - s.cancelled });
    m[s.type] = entry; void i; return m;
  }, {});

  const json: Record<string, unknown> = {
    gstin: biz.gstin, fp: bounds.fp, gt: 0, cur_gt: 0,
    ...(b2b.size ? { b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })) } : {}),
    ...(b2cl.size ? { b2cl: [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv })) } : {}),
    ...(b2cs.size ? { b2cs: [...b2cs.values()].map((x) => ({ sply_ty: x.sply, pos: x.pos, typ: 'OE', rt: x.rt, txval: R(x.a.txval), iamt: R(x.a.iamt), camt: R(x.a.camt), samt: R(x.a.samt), csamt: R(x.a.csamt) })) } : {}),
    ...(cdnr.size ? { cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })) } : {}),
    ...(cdnur.length ? { cdnur } : {}),
    ...(nilBuckets.size ? { nil: { inv: [...nilBuckets.entries()].map(([sply_ty, x]) => ({ sply_ty, expt_amt: R(x.expt), nil_amt: R(x.nil), ngsup_amt: R(x.ngsup) })) } } : {}),
    ...(hsn.size ? { hsn: { data: [...hsn.values()].map((h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.desc, uqc: h.uqc, qty: Number(h.qty.toFixed(3)), val: R(h.val), txval: R(h.a.txval), iamt: R(h.a.iamt), camt: R(h.a.camt), samt: R(h.a.samt), csamt: R(h.a.csamt), rt: h.rt })) } } : {}),
    ...(Object.keys(docDet).length ? { doc_issue: { doc_det: Object.values(docDet) } } : {}),
  };
  // Reconcile from what was actually placed in the sections, not from the same loop that placed it.
  const paise = (x: unknown) => BigInt(Math.round(Number(x) * 100));
  let reportedTaxable = 0n;
  const sumItems = (ls: Row[]) => ls.reduce((n, it) => n + paise(it.itm_det.txval), 0n);
  for (const invs of b2b.values()) for (const inv of invs) reportedTaxable += sumItems(inv.itms);
  for (const invs of b2cl.values()) for (const inv of invs) reportedTaxable += sumItems(inv.itms);
  for (const x of b2cs.values()) reportedTaxable += x.a.txval;
  for (const nts of cdnr.values()) for (const n of nts) reportedTaxable += (n.ntty === 'C' ? -1n : 1n) * sumItems(n.itms);
  for (const n of cdnur) reportedTaxable += (n.ntty === 'C' ? -1n : 1n) * sumItems(n.itms);
  for (const x of nilBuckets.values()) reportedTaxable += x.expt + x.nil + x.ngsup;
  warnings.push('Aggregate turnover (gt and cur_gt) is left at 0. Enter it in the GST portal or offline tool.');
  const counts = {
    b2b: [...b2b.values()].reduce((n, a) => n + a.length, 0), b2cl: [...b2cl.values()].reduce((n, a) => n + a.length, 0), b2cs: b2cs.size,
    cdnr: [...cdnr.values()].reduce((n, a) => n + a.length, 0), cdnur: cdnur.length, documents: docs.length,
  };
  return {
    period, json, counts, warnings,
    reconciliation: { ledgerTaxablePaise: ledgerTaxable.toString(), reportedTaxablePaise: reportedTaxable.toString(), matches: ledgerTaxable === reportedTaxable },
  };
}

/** Outward supplies for a month in the layout of GSTR-3B table 3.1, to help prepare the return. */
export async function gstSummary(sql: Sql, t: TenantSession, period: string) {
  const { docs, lines, biz } = await load(sql, t, period);
  const byDoc = new Map<string, Row[]>();
  for (const l of lines) { const a = byDoc.get(l.document_id as string) ?? []; a.push(l); byDoc.set(l.document_id as string, a); }
  const taxable = zero(), rcm = zero(), nil = { nil: 0n, exempt: 0n };
  const net = { credit: zero(), debit: zero() };
  const interUnreg = new Map<string, Agg>();
  for (const d of docs) {
    if (d.status === 'cancelled') continue;
    const ls = byDoc.get(d.id) ?? [];
    const sign = d.doc_type === 'credit_note' ? -1n : 1n;
    for (const l of ls) {
      if (d.doc_type === 'bill_of_supply') { nil.exempt += BigInt(l.taxable_paise); continue; }
      if (l.tax_rate_bp === 0) { nil.nil += sign * BigInt(l.taxable_paise); continue; }
      if (d.reverse_charge) { add(rcm, l, sign); continue; }
      add(taxable, l, sign);
      if (d.doc_type === 'credit_note') add(net.credit, l); else if (d.doc_type === 'debit_note') add(net.debit, l);
      const inter = d.place_of_supply !== (d.supplier_state ?? biz.state_code);
      if (inter && !d.buyer_gstin) { const a = interUnreg.get(d.place_of_supply) ?? zero(); add(a, l, sign); interUnreg.set(d.place_of_supply, a); }
    }
  }
  const out = (a: Agg) => ({ taxable: a.txval.toString(), igst: a.iamt.toString(), cgst: a.camt.toString(), sgst: a.samt.toString(), cess: a.csamt.toString() });
  return {
    period,
    outwardTaxable: out(taxable), outwardReverseCharge: out(rcm), nilRated: nil.nil.toString(), exempt: nil.exempt.toString(),
    creditNotes: out(net.credit), debitNotes: out(net.debit),
    interStateToUnregistered: [...interUnreg.entries()].map(([pos, a]) => ({ pos, ...out(a) })),
    totalTax: (taxable.iamt + taxable.camt + taxable.samt + taxable.csamt).toString(),
    notes: [
      'Outward taxable supplies are net of credit notes and include debit notes.',
      'Input tax credit and inward supplies are not included: Kora does not record purchases yet.',
      'This summary helps you prepare GSTR-3B. You remain responsible for the return.',
    ],
  };
}

/**
 * GSTR-3B for one month: table 3.1 (outward supplies) and 3.2 (inter-state supplies to unregistered buyers) from the
 * invoices, with the same figures laid out as the offline tool's JSON. Input tax credit (table 4), inward supplies (5)
 * and interest or late fee (5.1) are not tracked because Kora has no purchases yet, so they are left for the owner.
 *
 * Field names follow the GSTR-3B JSON as I know it and have not been checked against the current offline utility.
 * A CA must check the file before it is used. Kora prepares the data; the owner remains responsible for the return.
 */
export async function gstr3b(sql: Sql, t: TenantSession, period: string) {
  const s = await gstSummary(sql, t, period);
  const { fp } = periodBounds(period);
  const [biz] = await inTenant(sql, t, 'report.export', (tx) => tx`select gstin from business where id = ${t.businessId}`);
  const r = (p: string | bigint) => rupees(p.toString());
  const a = s.outwardTaxable;
  const nilExempt = BigInt(s.nilRated) + BigInt(s.exempt);
  const row = (label: string, x: { taxable: string; igst: string; cgst: string; sgst: string; cess: string }) => ({ label, ...x });
  const none = { taxable: '0', igst: '0', cgst: '0', sgst: '0', cess: '0' };

  const table31 = [
    row('(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', a),
    row('(b) Outward taxable supplies (zero rated)', none),
    row('(c) Other outward supplies (nil rated, exempted)', { ...none, taxable: nilExempt.toString() }),
    row('(d) Inward supplies (liable to reverse charge)', none),
    row('(e) Non-GST outward supplies', none),
  ];
  const liability = {
    igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess,
    total: (BigInt(a.igst) + BigInt(a.cgst) + BigInt(a.sgst) + BigInt(a.cess)).toString(),
  };
  const json = {
    gstin: (biz?.gstin as string | null) ?? '',
    ret_period: fp,
    sup_details: {
      osup_det: { txval: r(a.taxable), iamt: r(a.igst), camt: r(a.cgst), samt: r(a.sgst), csamt: r(a.cess) },
      osup_zero: { txval: r(0n), iamt: r(0n), csamt: r(0n) },
      osup_nil_exmp: { txval: r(nilExempt) },
      isup_rev: { txval: r(0n), iamt: r(0n), camt: r(0n), samt: r(0n), csamt: r(0n) },
      osup_nongst: { txval: r(0n) },
    },
    inter_sup: {
      unreg_details: s.interStateToUnregistered.map((x) => ({ pos: x.pos, txval: r(x.taxable), iamt: r(x.igst) })),
      comp_details: [] as unknown[],
      uin_details: [] as unknown[],
    },
  };
  return {
    period, gstin: json.gstin, table31, table32: s.interStateToUnregistered, liability, json,
    notes: [
      'Outward supplies are net of credit notes and include debit notes. Cancelled documents are left out.',
      'Table 4 (input tax credit), table 5 (inward exempt and nil supplies) and 5.1 (interest and late fee) are not filled: Kora does not record purchases yet. Add them in the GST offline tool or portal.',
      'Table 3.1(a) here is the tax you owe before any input tax credit.',
      'Supplies where the recipient pays the tax are not in 3.1(a); they appear on the GST summary, and your CA should decide where they go.',
      'Table 3.2 lists inter-state supplies to buyers without a GSTIN. Supplies to composition dealers and UIN holders are not separated yet.',
      'The file layout has not been checked against the latest GST offline utility. Have your CA check it before use.',
    ],
  };
}
