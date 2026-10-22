'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees, TAX_RATES } from '../../../lib/client';

type Row = { msme_state?: 'overdue' | 'soon' | 'ok'; msme_days_left?: number; id: string; bill_number: string; bill_date: string; due_date: string | null; status: string; reverse_charge: boolean; itc_status: string; vendor: string; total_paise: string; paid_paise: string; due_paise: string };
type Party = { id: string; name: string; kind: string };
type Line = { description: string; hsnSac: string; quantity: string; rate: string; taxRateBp: number };
const blank = (): Line => ({ description: '', hsnSac: '', quantity: '1', rate: '', taxRateBp: 1800 });
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** Bills from vendors: what you bought, what you owe, and the input tax credit each one carries. */
export default function Purchases() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [vendors, setVendors] = useState<Party[]>([]);
  const [role, setRole] = useState('');
  const [tab, setTab] = useState<'' | 'open' | 'paid' | 'cancelled'>('open');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ partyId: '', billNumber: '', billDate: today(), dueDate: '', reverseCharge: false });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setRows((await api(`/api/purchases?${tab ? `state=${tab}&` : ''}${q.trim() ? `q=${encodeURIComponent(q.trim())}` : ''}`)).bills); }, [tab, q]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  useEffect(() => {
    api('/api/business').then((b) => setRole(b.role));
    api('/api/parties').then((r) => setVendors((r.parties as Party[]).filter((p) => p.kind !== 'customer')));
  }, []);
  const canWrite = role === 'owner' || role === 'staff' || role === 'accountant';
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));

  return (
    <>
      <div className="toolbar">
        <div><h1>Purchases</h1><p className="page-sub">Bills from your vendors, what you owe them, and the tax credit on each.</p></div>
        <div className="row" style={{ flex: 'none' }}>
          <a className="btn secondary" href="/app/itc">Input credit</a>
          {canWrite && <button onClick={() => setAdding((v) => !v)}><Icon name="plus" size={18} />New bill</button>}
        </div>
      </div>

      {adding && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); setErr(''); setBusy(true);
          api('/api/purchases', { body: { ...f, dueDate: f.dueDate || undefined, lines: lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac || undefined, quantity: l.quantity, rate: l.rate, taxRateBp: l.taxRateBp })) } })
            .then((r) => { window.location.href = `/app/purchases/${r.id}`; }).catch((x) => { setErr(x.message); setBusy(false); }); }}>
          <p className="section-label">New bill</p>
          <div className="row">
            <div><label htmlFor="pv" style={{ marginTop: 0 }}>Vendor</label>
              <select id="pv" value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} required>
                <option value="">Choose a vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label htmlFor="pn" style={{ marginTop: 0 }}>Vendor&apos;s bill number</label><input id="pn" value={f.billNumber} maxLength={40} onChange={(e) => setF({ ...f, billNumber: e.target.value })} required /></div>
            <div><label htmlFor="pd" style={{ marginTop: 0 }}>Bill date</label><input id="pd" type="date" value={f.billDate} onChange={(e) => setF({ ...f, billDate: e.target.value })} required /></div>
            <div><label htmlFor="pdu" style={{ marginTop: 0 }}>Due date</label><input id="pdu" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>
          </div>
          <table className="t line-table" aria-label="Bill lines" style={{ marginTop: 14 }}>
            <thead><tr><th>Description</th><th>HSN/SAC</th><th className="n">Qty</th><th className="n">Rate</th><th>GST</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td data-label="Description"><input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} required /></td>
                <td data-label="HSN or SAC"><input aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></td>
                <td className="n" data-label="Quantity"><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required /></td>
                <td className="n" data-label="Rate"><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} required /></td>
                <td data-label="GST"><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(i, { taxRateBp: Number(e.target.value) })}>{TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td className="line-remove">{lines.length > 1 && <button type="button" className="link" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>Remove</button>}</td>
              </tr>))}</tbody>
          </table>
          <button type="button" className="secondary sm" style={{ marginTop: 10 }} onClick={() => setLines((ls) => [...ls, blank()])}><Icon name="plus" size={16} />Add line</button>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={f.reverseCharge} onChange={(e) => setF({ ...f, reverseCharge: e.target.checked })} /> I pay the tax on this bill (reverse charge)</label>
          <p className="muted" style={{ fontSize: 13 }}>Tax is worked out from the vendor&apos;s state and yours. Enter the rates and amounts as printed on the bill.</p>
          {err && <p className="error" role="alert">{err}</p>}
          <button disabled={busy}>Record bill</button>
        </form>
      )}
      {!adding && err && <p className="error" role="alert">{err}</p>}

      <div className="tabs" role="group" aria-label="Bill status">
        {([['open', 'Owed'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['', 'All']] as const).map(([k, label]) => <button key={k || 'all'} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="filters"><div style={{ flex: 1 }}><label htmlFor="pq">Search</label><input id="pq" type="search" placeholder="Vendor or bill number" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>

      {rows === null && !err && <KoraLoader />}
      {rows && rows.length === 0 && <div className="panel empty"><Icon name="receipt" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No bills here.</h3><p>Record a bill from a vendor to track what you owe and the credit you can claim.</p></div>}
      {rows && rows.length > 0 && (
        <table className="t cards" aria-label="Bills">
          <thead><tr><th>Bill</th><th>Vendor</th><th>Date</th><th className="n">Total</th><th className="n">Due</th><th>Credit</th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}>
              <td className="c-num"><a href={`/app/purchases/${b.id}`}>{b.bill_number}</a>{b.status === 'cancelled' && <> <span className="chip cancelled">Cancelled</span></>}{b.reverse_charge && <> <span className="chip draft">Reverse charge</span></>}</td>
              <td className="c-cust">{b.vendor}</td><td className="c-date">{b.bill_date}</td>
              <td className="n c-total">{rupees(b.total_paise)}</td>
              <td className="n c-type">{b.status === 'cancelled' ? '' : BigInt(b.due_paise) > 0n ? rupees(b.due_paise) : <span className="chip paid">Paid</span>}</td>
              <td className="c-status">{b.msme_state === 'overdue' && <span className="chip cancelled" title="A micro or small supplier should be paid within 45 days of the bill">MSME overdue</span>}{b.msme_state === 'soon' && <span className="chip due" title="A micro or small supplier should be paid within 45 days of the bill">MSME {b.msme_days_left === 0 ? 'due today' : `${b.msme_days_left} days left`}</span>} {b.itc_status === 'blocked' ? <span className="chip cancelled">Blocked</span> : <span className="chip issued">Eligible</span>}</td>
            </tr>))}</tbody>
        </table>)}
    </>
  );
}
