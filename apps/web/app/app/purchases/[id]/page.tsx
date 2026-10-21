'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../../../lib/client';

type Detail = {
  bill: { id: string; vendor: string; vendorGstin: string | null; billNumber: string; billDate: string; dueDate: string | null; supply: string; reverseCharge: boolean; status: string;
    taxablePaise: string; cgstPaise: string; sgstPaise: string; igstPaise: string; cessPaise: string; totalPaise: string; paidPaise: string; itcStatus: string; itcReason: string | null; notes: string | null };
  lines: { line_no: number; description: string; hsn_sac: string | null; quantity: string; rate_paise: string; tax_rate_bp: number; taxable_paise: string; total_paise: string }[];
  payments: { id: string; paid_on: string; amount_paise: string; tds_paise: string; tds_section: string | null; method: string; note: string | null }[];
  in2b: { period: string; invoiceNumber: string } | null;
  msme: { class: string; udyamNumber: string; deadline: string; open: boolean; state: 'overdue' | 'soon' | 'ok'; daysLeft: number } | null;
};
const TDS_SECTIONS: [string, string][] = [['194C', 'Contractors'], ['194J', 'Professional fees'], ['194H', 'Commission'], ['194I', 'Rent'], ['194Q', 'Purchase of goods'], ['194A', 'Interest'], ['194O', 'E-commerce'], ['194M', 'Individual or HUF contract'], ['195', 'Non-residents']];
const METHODS: [string, string][] = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['netbanking', 'Net banking'], ['other', 'Other']];

export default function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'bank_transfer', note: '', tds: '', tdsSection: '194C' });
  const [block, setBlock] = useState({ open: false, reason: '' });

  const load = useCallback(async () => { setD(await api(`/api/purchases/${id}`)); }, [id]);
  useEffect(() => { load().catch((e) => setErr(e.message)); api('/api/business').then((b) => setRole(b.role)); }, [load]);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (!d) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  const b = d.bill;
  const canWrite = role === 'owner' || role === 'staff' || role === 'accountant';
  const due = BigInt(b.totalPaise) - BigInt(b.paidPaise);
  const tax = BigInt(b.cgstPaise) + BigInt(b.sgstPaise) + BigInt(b.igstPaise) + BigInt(b.cessPaise);
  const cancelled = b.status === 'cancelled';

  return (
    <>
      <div className="doc-head">
        <div>
          <h1>Bill {b.billNumber}</h1>
          <div className="meta">
            {cancelled ? <span className="chip cancelled">Cancelled</span> : due === 0n ? <span className="chip paid">Paid</span> : <span className="chip issued">Owed</span>}
            <span>{b.vendor}{b.vendorGstin ? ` · ${b.vendorGstin}` : ''} · {b.billDate}{b.dueDate ? ` · due ${b.dueDate}` : ''}</span>
          </div>
        </div>
        <div className="doc-amount"><div className="big" data-testid="bill-total">{rupees(b.totalPaise)}</div>{!cancelled && due > 0n && <div className="due">{rupees(due)} owed</div>}</div>
        <div className="row doc-actions">
          <a className="btn secondary" href="/app/purchases">Back</a>
          {canWrite && !cancelled && BigInt(b.paidPaise) === 0n && <button className="danger" disabled={busy} onClick={() => run(async () => { await api(`/api/purchases/${id}/cancel`, { body: {} }); await load(); })}>Cancel bill</button>}
        </div>
      </div>
      {d.msme && d.msme.open && d.msme.state !== 'ok' && (
        <div className={`notice ${d.msme.state === 'overdue' ? 'critical' : 'warning'}`} role="alert" data-testid="msme-warning" style={{ marginBottom: 12 }}>
          <div>
            <b>{d.msme.state === 'overdue' ? `Past the 45-day limit by ${-d.msme.daysLeft} day${d.msme.daysLeft === -1 ? '' : 's'}` : d.msme.daysLeft === 0 ? 'The 45-day limit ends today' : `${d.msme.daysLeft} day${d.msme.daysLeft === 1 ? '' : 's'} left in the 45-day limit`}</b>
            <div className="muted">{b.vendor} is a {d.msme.class} enterprise ({d.msme.udyamNumber}). The law expects micro and small suppliers to be paid within 45 days of the bill, here by {d.msme.deadline}. Late payment can cost interest and may affect your tax deduction, so check with your CA.</div>
          </div>
        </div>)}
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <div className="doc-layout">
        <div>
          <div className="panel">
            <p className="section-label">Items</p>
            <table className="t" aria-label="Bill lines">
              <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="n">Qty</th><th className="n">Taxable</th><th className="n">GST</th></tr></thead>
              <tbody>{d.lines.map((l) => (<tr key={l.line_no}><td>{l.line_no}</td><td>{l.description}</td><td>{l.hsn_sac ?? ''}</td><td className="n">{l.quantity}</td><td className="n">{rupees(l.taxable_paise)}</td><td className="n">{l.tax_rate_bp / 100}%</td></tr>))}</tbody>
            </table>
            <div className="totals" style={{ marginTop: 14 }} aria-label="Totals">
              <div className="trow"><span>Taxable value</span><span>{rupees(b.taxablePaise)}</span></div>
              {b.supply === 'intra' ? (<><div className="trow"><span>CGST</span><span>{rupees(b.cgstPaise)}</span></div><div className="trow"><span>SGST</span><span>{rupees(b.sgstPaise)}</span></div></>) : <div className="trow"><span>IGST</span><span>{rupees(b.igstPaise)}</span></div>}
              {BigInt(b.cessPaise) > 0n && <div className="trow"><span>Cess</span><span>{rupees(b.cessPaise)}</span></div>}
              <div className="trow grand"><span>{b.reverseCharge ? 'Owed to vendor' : 'Total'}</span><span>{rupees(b.totalPaise)}</span></div>
              {b.reverseCharge && <p className="muted" style={{ fontSize: 13 }}>You pay the tax of {rupees(tax)} yourself under reverse charge.</p>}
            </div>
          </div>
          {b.notes && <div className="panel"><p className="section-label">Notes</p><p>{b.notes}</p></div>}
        </div>

        <div className="doc-side">
          <div className="panel" aria-label="Payments">
            <h2>Payments</h2>
            {d.payments.length > 0 && (
              <ul className="plain">{d.payments.map((p) => (
                <li key={p.id}><span>{p.paid_on} · {METHODS.find((m) => m[0] === p.method)?.[1] ?? p.method}{BigInt(p.tds_paise) > 0n ? ` · ${rupees(p.tds_paise)} TDS under ${p.tds_section}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
                  <span>{rupees(p.amount_paise)} {canWrite && <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/purchases/payments/${p.id}`, { method: 'DELETE' }); await load(); })}>Remove</button>}</span></li>))}</ul>)}
            {!cancelled && due > 0n ? (canWrite && (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/purchases/${id}/pay`, { body: { amount: pay.amount, method: pay.method, note: pay.note || undefined, tds: pay.tds || undefined, tdsSection: pay.tds ? pay.tdsSection : undefined } }); setPay({ amount: '', method: pay.method, note: '', tds: '', tdsSection: pay.tdsSection }); setMsg('Payment recorded.'); await load(); }); }}>
                <p><b>{rupees(due)}</b> still owed.</p>
                <label htmlFor="bpa">Amount paid (Rs)</label><input id="bpa" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
                <label htmlFor="bpm">Method</label><select id="bpm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <label htmlFor="bpt">Tax held back (TDS), if any (Rs)</label><input id="bpt" inputMode="decimal" value={pay.tds} onChange={(e) => setPay({ ...pay, tds: e.target.value })} />
                {pay.tds && (<><label htmlFor="bps">TDS section</label><select id="bps" value={pay.tdsSection} onChange={(e) => setPay({ ...pay, tdsSection: e.target.value })}>{TDS_SECTIONS.map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></>)}
                <label htmlFor="bpn">Note</label><input id="bpn" value={pay.note} maxLength={300} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
                <button disabled={busy} style={{ marginTop: 12 }}>Record payment</button>
              </form>)) : !cancelled && <p className="ok">Fully paid.</p>}
          </div>

          <div className="panel" aria-label="Input tax credit">
            <h2>Input tax credit</h2>
            {b.itcStatus === 'blocked' ? <p><span className="chip cancelled">Blocked</span> {b.itcReason}</p> : <p><span className="chip issued">Eligible</span> {rupees(tax)} can be claimed{b.reverseCharge ? ' after you pay the tax' : ''}.</p>}
            <p className="muted" style={{ fontSize: 13 }}>{d.in2b ? `Found in the supplier's GSTR-2B for ${d.in2b.period} as ${d.in2b.invoiceNumber}.` : 'Not matched to a GSTR-2B line yet. Credit is safest to claim once the supplier has filed it.'}</p>
            {canWrite && !cancelled && (b.itcStatus === 'blocked'
              ? <button className="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/purchases/${id}/itc`, { method: 'PATCH', body: { status: 'eligible' } }); await load(); })}>Mark eligible</button>
              : block.open ? (
                <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/purchases/${id}/itc`, { method: 'PATCH', body: { status: 'blocked', reason: block.reason } }); setBlock({ open: false, reason: '' }); await load(); }); }}>
                  <label htmlFor="br">Why is the credit blocked?</label><input id="br" value={block.reason} maxLength={300} placeholder="Food and beverages, personal use, motor vehicle" onChange={(e) => setBlock({ ...block, reason: e.target.value })} required />
                  <button className="danger" disabled={busy} style={{ marginTop: 10 }}>Block credit</button>
                </form>) : <button className="secondary" onClick={() => setBlock({ open: true, reason: '' })}>Block this credit</button>)}
          </div>
        </div>
      </div>
    </>
  );
}
