'use client';
import { use, useEffect, useMemo, useState } from 'react';
import { api, rupees } from '../../../../../lib/client';

type Ctx = {
  number: string | null; status: string; docType: string; invoicedTaxablePaise: string; creditedTaxablePaise: string;
  lines: { position: number; name: string; quantity: string; unit: string; ratePaise: string; taxRateBp: number }[];
  notes: { id: string; number: string | null; doc_type: string; status: string; grand_total_paise: string }[];
  reasons: Record<'credit_note' | 'debit_note', string[]>;
};
type Pick = { on: boolean; quantity: string; rate: string };

const REASON_TEXT: Record<string, string> = {
  goods_returned: 'Goods returned by the customer', post_sale_discount: 'Discount given after the sale', price_correction: 'Price was wrong',
  quantity_correction: 'Quantity was wrong', service_deficiency: 'Service was short or not up to the mark', tax_rate_correction: 'Tax rate was wrong',
  additional_charge: 'Extra charge to add', other: 'Something else',
};
const rs = (p: string) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };

/** A guided way to raise a credit or debit note: why, which lines, how much. It ends in a draft to check and issue. */
export default function GuidedNote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [kind, setKind] = useState<'credit_note' | 'debit_note'>('credit_note');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('kind');
    if (k === 'debit_note') setKind('debit_note');
    api(`/api/documents/${id}/note-context`).then((c: Ctx) => {
      setCtx(c);
      setPicks(Object.fromEntries(c.lines.map((l) => [l.position, { on: false, quantity: l.quantity.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), rate: rs(l.ratePaise) }])));
    }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => { setReason(''); }, [kind]);

  const chosen = useMemo(() => (ctx ? ctx.lines.filter((l) => picks[l.position]?.on) : []), [ctx, picks]);
  if (!ctx) return <p className="muted">{err || 'Loading'}</p>;
  if (ctx.status !== 'issued') return <p className="error" role="alert">Only an issued invoice can be corrected with a note.</p>;

  const left = BigInt(ctx.invoicedTaxablePaise) - BigInt(ctx.creditedTaxablePaise);
  const setPick = (pos: number, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [pos]: { ...p[pos]!, ...patch } }));
  const credit = kind === 'credit_note';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api(`/api/documents/${id}/note`, { body: {
        kind, reason: reason || undefined, detail: detail.trim() || undefined,
        lines: chosen.map((l) => ({ position: l.position, quantity: picks[l.position]!.quantity, rate: picks[l.position]!.rate })),
      } });
      window.location.href = `/app/invoices/${r.id}`;
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/app/invoices">Documents</a><span aria-hidden="true">/</span><a href={`/app/invoices/${id}`}>{ctx.number}</a><span aria-hidden="true">/</span><span aria-current="page">Raise a note</span></nav>
      <div className="toolbar"><div><h1>Correct invoice {ctx.number}</h1><p className="page-sub">Answer three questions. Kora builds the note as a draft for you to check, then you issue it.</p></div></div>
      <form onSubmit={submit}>
        <section className="panel" aria-label="Step 1, what kind of note">
          <p className="section-label">1. What do you want to do?</p>
          <div className="choice-row" role="radiogroup" aria-label="Kind of note">
            <label className="choice"><input type="radio" name="kind" checked={credit} onChange={() => setKind('credit_note')} /> <b>Reduce what the customer owes</b><span className="muted">Credit note. For returns, discounts after the sale, or a price that was too high.</span></label>
            <label className="choice"><input type="radio" name="kind" checked={!credit} onChange={() => setKind('debit_note')} /> <b>Charge the customer more</b><span className="muted">Debit note. For a price that was too low or an extra charge you forgot.</span></label>
          </div>
        </section>

        <section className="panel" aria-label="Step 2, why">
          <p className="section-label">2. Why?</p>
          <label htmlFor="rs">Reason</label>
          <select id="rs" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Choose a reason</option>
            {ctx.reasons[kind].map((k) => <option key={k} value={k}>{REASON_TEXT[k] ?? k}</option>)}
          </select>
          <label htmlFor="dt">A line of detail (optional)</label>
          <input id="dt" maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="For example: 3 chairs came back with broken legs" />
        </section>

        <section className="panel" aria-label="Step 3, which lines">
          <p className="section-label">3. Which lines?</p>
          {credit && <p className="muted">You invoiced {rupees(ctx.invoicedTaxablePaise)} before tax and have already credited {rupees(ctx.creditedTaxablePaise)}, so you can credit up to {rupees(left)} more.</p>}
          <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
            <button type="button" className="secondary sm" onClick={() => setPicks((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, on: true }])))}>Pick every line</button>
            <button type="button" className="secondary sm" onClick={() => setPicks((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, on: false }])))}>Clear</button>
          </div>
          <table className="t line-table" aria-label="Lines of the invoice">
            <thead><tr><th>Use</th><th>Item</th><th className="n">Invoiced</th><th className="n">{credit ? 'Quantity to credit' : 'Quantity to charge'}</th><th className="n">{credit ? 'Rate to credit' : 'Rate to charge'}</th></tr></thead>
            <tbody>{ctx.lines.map((l) => {
              const p = picks[l.position]!;
              return (
                <tr key={l.position}>
                  <td data-label="Use"><input type="checkbox" aria-label={`Use line ${l.position}, ${l.name}`} checked={p.on} onChange={(e) => setPick(l.position, { on: e.target.checked })} /></td>
                  <td data-label="Item">{l.name}</td>
                  <td className="n" data-label="Invoiced">{l.quantity.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} {l.unit} at {rupees(l.ratePaise)}</td>
                  <td className="n" data-label="Quantity"><input aria-label={`Quantity for line ${l.position}`} inputMode="decimal" value={p.quantity} disabled={!p.on} onChange={(e) => setPick(l.position, { quantity: e.target.value })} /></td>
                  <td className="n" data-label="Rate"><input aria-label={`Rate for line ${l.position}`} inputMode="decimal" value={p.rate} disabled={!p.on} onChange={(e) => setPick(l.position, { rate: e.target.value })} /></td>
                </tr>);
            })}</tbody>
          </table>
          {credit && <p className="muted">For a discount after the sale, keep the quantity and lower the rate. For a return, lower the quantity.</p>}
        </section>

        {ctx.notes.length > 0 && (
          <section className="panel" aria-label="Notes already raised">
            <p className="section-label">Already raised against this invoice</p>
            <ul className="plain">{ctx.notes.map((n) => (
              <li key={n.id}><a href={`/app/invoices/${n.id}`}>{n.doc_type === 'credit_note' ? 'Credit note' : 'Debit note'} {n.number ?? '(draft)'}</a><span className="muted">{n.status} · {rupees(n.grand_total_paise)}</span></li>))}</ul>
          </section>
        )}

        {err && <p className="error" role="alert">{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <button style={{ flex: 'none' }} disabled={busy || chosen.length === 0 || !reason}>{busy ? 'Making the draft' : `Make the ${credit ? 'credit' : 'debit'} note draft`}</button>
          <a className="btn secondary" href={`/app/invoices/${id}`}>Back to the invoice</a>
        </div>
        {chosen.length === 0 && <p className="muted">Pick at least one line to continue.</p>}
      </form>
    </>
  );
}
