'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, rupees } from '../../../lib/client';

type Tab = 'sales' | 'customers' | 'payments' | 'ageing' | 'statement' | 'gst' | 'gstr1';
const TABS: [Tab, string][] = [['sales', 'Sales register'], ['customers', 'Sales by customer'], ['payments', 'Payments received'], ['ageing', 'Who owes you'], ['statement', 'Customer statement'], ['gst', 'GST summary'], ['gstr1', 'GSTR-1 data']];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function Reports() {
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(() => today().slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [party, setParty] = useState('');
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState<{ query: string; body: any } | null>(null);
  const [err, setErr] = useState('');
  const [canExport, setCanExport] = useState(false);

  useEffect(() => { api('/api/parties').then((r) => { setParties(r.parties); if (r.parties[0]) setParty((p) => p || r.parties[0].id); }); api('/api/business').then((b) => setCanExport(['owner', 'accountant'].includes(b.role))); }, []);

  const query = useMemo(() => {
    const range = `from=${from}&to=${to}`;
    switch (tab) {
      case 'sales': return `/api/reports/sales?${range}`;
      case 'customers': return `/api/reports/customers?${range}`;
      case 'payments': return `/api/reports/payments?${range}`;
      case 'ageing': return `/api/reports/ageing?asOf=${to}`;
      case 'statement': return party ? `/api/reports/statement?${range}&party=${party}` : '';
      case 'gst': return `/api/reports/gst-summary?period=${month}`;
      case 'gstr1': return `/api/reports/gstr1?period=${month}`;
    }
  }, [tab, from, to, month, party]);

  useEffect(() => {
    setErr('');
    if (!query) return;
    let stale = false;
    const h = setTimeout(() => api(query).then((body) => { if (!stale) setLoaded({ query, body }); }).catch((e) => { if (!stale) setErr(e.message); }), 150);
    return () => { stale = true; clearTimeout(h); };
  }, [query]);
  // Only ever show data that belongs to the tab on screen: the previous tab's rows have a different shape.
  const data = loaded && loaded.query === query ? loaded.body : null;

  const monthly = tab === 'gst' || tab === 'gstr1';
  const csvHref = query && ['sales', 'customers', 'payments', 'ageing', 'statement'].includes(tab) ? `${query}${query.includes('?') ? '&' : '?'}format=csv` : '';

  return (
    <>
      <div className="toolbar"><h1>Reports</h1>
        <div className="row" style={{ flex: 'none' }}>
          {csvHref && canExport && <a className="btn secondary" href={csvHref}>Download CSV</a>}
          {tab === 'gstr1' && canExport && <a className="btn secondary" href={`/api/reports/gstr1?period=${month}&download=1`}>Download GSTR-1 JSON</a>}
        </div>
      </div>
      <div role="tablist" className="row" style={{ marginBottom: 12, justifyContent: 'flex-start' }}>
        {TABS.map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? '' : 'secondary'} style={{ flex: 'none', marginTop: 0 }} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {monthly ? <div><label htmlFor="rm">Month</label><input id="rm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div> : (<>
          {tab !== 'ageing' && <div><label htmlFor="rf">From</label><input id="rf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>}
          <div><label htmlFor="rt">{tab === 'ageing' ? 'As on' : 'To'}</label><input id="rt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </>)}
        {tab === 'statement' && <div><label htmlFor="rp">Customer</label><select id="rp" value={party} onChange={(e) => setParty(e.target.value)}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">Loading</p>}

      {tab === 'sales' && data && (
        <table className="t"><thead><tr><th>Date</th><th>Number</th><th>Type</th><th>Customer</th><th className="n">Taxable</th><th className="n">Tax</th><th className="n">Total</th></tr></thead>
          <tbody>{data.rows.map((r: any) => <tr key={r.number} style={r.status === 'Cancelled' ? { opacity: 0.55 } : undefined}><td>{r.doc_date}</td><td>{r.number}</td><td>{r.type}{r.status === 'Cancelled' ? ' (cancelled)' : ''}</td><td>{r.customer}</td>
            <td className="n">{rupees(r.taxable)}</td><td className="n">{rupees(BigInt(r.cgst) + BigInt(r.sgst) + BigInt(r.igst) + BigInt(r.cess))}</td><td className="n">{rupees(r.total)}</td></tr>)}
            <tr><td colSpan={4}><b>{data.totals.count} documents</b></td><td className="n"><b>{rupees(data.totals.taxable)}</b></td><td className="n"><b>{rupees(BigInt(data.totals.cgst) + BigInt(data.totals.sgst) + BigInt(data.totals.igst) + BigInt(data.totals.cess))}</b></td><td className="n"><b>{rupees(data.totals.total)}</b></td></tr></tbody></table>
      )}
      {tab === 'customers' && data && (
        <table className="t"><thead><tr><th>Customer</th><th className="n">Documents</th><th className="n">Net sales</th><th className="n">Still owed</th></tr></thead>
          <tbody>{data.rows.map((r: any) => <tr key={r.customer}><td>{r.customer}</td><td className="n">{r.documents}</td><td className="n">{rupees(r.total)}</td><td className="n">{rupees(r.outstanding)}</td></tr>)}</tbody></table>
      )}
      {tab === 'payments' && data && (
        <table className="t"><thead><tr><th>Date</th><th>Customer</th><th>Method</th><th>Invoices</th><th className="n">Amount</th></tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => <tr key={i}><td>{r.received_on}</td><td>{r.customer}</td><td>{r.method}</td><td>{r.invoices}{BigInt(r.unallocated) > 0n ? ` (${rupees(r.unallocated)} not applied)` : ''}</td><td className="n">{rupees(r.amount)}</td></tr>)}
            <tr><td colSpan={4}><b>Total received</b></td><td className="n"><b>{rupees(data.total)}</b></td></tr></tbody></table>
      )}
      {tab === 'ageing' && data && (
        <table className="t"><thead><tr><th>Customer</th><th className="n">Not due</th><th className="n">1-30</th><th className="n">31-60</th><th className="n">61-90</th><th className="n">Over 90</th><th className="n">Total</th></tr></thead>
          <tbody>{data.rows.map((r: any) => <tr key={r.partyId ?? 'w'}><td>{r.partyName}</td>{['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'].map((k) => <td className="n" key={k}>{BigInt(r.buckets[k]) ? rupees(r.buckets[k]) : ''}</td>)}<td className="n"><b>{rupees(r.totalPaise)}</b></td></tr>)}
            <tr><td><b>Total</b></td>{['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'].map((k) => <td className="n" key={k}><b>{rupees(data.totals[k])}</b></td>)}<td className="n"><b>{rupees(data.totals.total)}</b></td></tr></tbody></table>
      )}
      {tab === 'statement' && data && (
        <table className="t"><thead><tr><th>Date</th><th>Description</th><th className="n">Billed</th><th className="n">Received or credited</th><th className="n">Balance</th></tr></thead>
          <tbody><tr><td colSpan={4}>Opening balance</td><td className="n">{rupees(data.opening)}</td></tr>
            {data.rows.map((r: any, i: number) => <tr key={i}><td>{r.date}</td><td>{r.description}</td><td className="n">{BigInt(r.debit) ? rupees(r.debit) : ''}</td><td className="n">{BigInt(r.credit) ? rupees(r.credit) : ''}</td><td className="n">{rupees(r.balance)}</td></tr>)}
            <tr><td colSpan={4}><b>Closing balance</b></td><td className="n"><b>{rupees(data.closing)}</b></td></tr></tbody></table>
      )}
      {tab === 'gst' && data && (
        <>
          <table className="t"><thead><tr><th>Outward supplies</th><th className="n">Taxable value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th></tr></thead>
            <tbody>
              {([['Taxable supplies (net of credit notes)', data.outwardTaxable], ['Liable to reverse charge', data.outwardReverseCharge]] as const).map(([l, x]) => <tr key={l}><td>{l}</td><td className="n">{rupees(x.taxable)}</td><td className="n">{rupees(x.igst)}</td><td className="n">{rupees(x.cgst)}</td><td className="n">{rupees(x.sgst)}</td><td className="n">{rupees(x.cess)}</td></tr>)}
              <tr><td>Nil-rated</td><td className="n">{rupees(data.nilRated)}</td><td colSpan={4} /></tr>
              <tr><td>Exempt (bills of supply)</td><td className="n">{rupees(data.exempt)}</td><td colSpan={4} /></tr>
              <tr><td><b>Total tax</b></td><td /><td className="n" colSpan={4}><b>{rupees(data.totalTax)}</b></td></tr>
            </tbody></table>
          <ul className="muted">{data.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {tab === 'gstr1' && data && (
        <>
          <div className="panel">
            <p><b>{data.counts.documents}</b> documents this month: {data.counts.b2b} to registered businesses, {data.counts.b2cl} large inter-state to consumers, {data.counts.b2cs} consolidated consumer lines, {data.counts.cdnr + data.counts.cdnur} credit or debit notes.</p>
            {data.reconciliation.matches
              ? <p className="ok">The sections add up to your sales ledger exactly.</p>
              : <p className="error" role="alert">The sections do not add up to your ledger. Do not file this. Contact support.</p>}
            <ul className="muted">{data.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>
            <p className="muted">Kora prepares this data. Check it in the GST offline tool and file the return yourself or through your CA. You remain responsible for the filing.</p>
          </div>
        </>
      )}
    </>
  );
}
