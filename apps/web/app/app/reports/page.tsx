'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useEffect, useMemo, useState } from 'react';
import { STATE_NAMES } from '@kora/tax';
import { api, rupees } from '../../../lib/client';

type Tab = 'items' | 'months' | 'pnl' | 'payables' | 'sales' | 'customers' | 'payments' | 'ageing' | 'statement' | 'tds' | 'tdspayable' | 'gst' | 'gstr3b' | 'gstr1';
const TABS: [Tab, string][] = [['sales', 'Sales register'], ['customers', 'Sales by customer'], ['items', 'Sales by item'], ['months', 'Sales by month'], ['pnl', 'Profit and loss'], ['payables', 'Who you owe'], ['payments', 'Payments received'], ['ageing', 'Who owes you'], ['statement', 'Customer statement'], ['tds', 'TDS deducted'], ['tdspayable', 'TDS payable'], ['gst', 'GST summary'], ['gstr3b', 'GSTR-3B data'], ['gstr1', 'GSTR-1 data']];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function Reports() {
  const initial = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<Tab>(() => (TABS.some(([k]) => k === initial.get('tab')) ? (initial.get('tab') as Tab) : 'sales'));
  const [from, setFrom] = useState(() => today().slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [party, setParty] = useState(() => initial.get('party') ?? '');
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState<{ query: string; body: any } | null>(null);
  const [err, setErr] = useState('');
  const [canExport, setCanExport] = useState(false);
  type View = { name: string; tab: Tab; from: string; to: string; party: string };
  const [views, setViews] = useState<View[]>([]);
  const [viewName, setViewName] = useState('');
  useEffect(() => { try { setViews(JSON.parse(localStorage.getItem('kora.reportViews') ?? '[]')); } catch { /* no saved views */ } }, []);
  const keepViews = (v: View[]) => { setViews(v); try { localStorage.setItem('kora.reportViews', JSON.stringify(v)); } catch { /* storage blocked: views last until the page closes */ } };
  const [canSend, setCanSend] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string; email: string | null; is_primary: boolean }[]>([]);
  const [contact, setContact] = useState('');
  const [sent, setSent] = useState('');

  useEffect(() => { api('/api/parties').then((r) => { setParties(r.parties); if (r.parties[0]) setParty((p) => p || r.parties[0].id); }); api('/api/business').then((b) => { setCanExport(['owner', 'accountant'].includes(b.role)); setCanSend(['owner', 'staff'].includes(b.role)); }); }, []);

  // Who the statement can go to: the people in this customer's contact book who have an email.
  useEffect(() => {
    setContacts([]); setContact(''); setSent('');
    if (tab !== 'statement' || !party) return;
    let stale = false;
    api(`/api/parties/${party}/contacts`).then((r) => {
      if (stale) return;
      const withEmail = (r.contacts as typeof contacts).filter((c) => c.email);
      setContacts(withEmail);
      setContact(withEmail.find((c) => c.is_primary)?.id ?? '');
    }).catch(() => {});
    return () => { stale = true; };
  }, [tab, party]);

  const sendStatement = async () => {
    setErr(''); setSent('');
    try {
      const r = await api('/api/reports/statement/send', { body: { party, from, to, contactPersonId: contact || null } });
      setSent(`Statement queued for ${r.email}.`);
    } catch (e) { setErr((e as Error).message); }
  };

  const query = useMemo(() => {
    const range = `from=${from}&to=${to}`;
    switch (tab) {
      case 'sales': return `/api/reports/sales?${range}`;
      case 'items': return `/api/reports/items?${range}`;
      case 'months': return `/api/reports/months?${range}`;
      case 'pnl': return `/api/reports/pnl?${range}`;
      case 'payables': return '/api/reports/payables';
      case 'customers': return `/api/reports/customers?${range}`;
      case 'payments': return `/api/reports/payments?${range}`;
      case 'ageing': return `/api/reports/ageing?asOf=${to}`;
      case 'tds': return `/api/reports/tds?${range}`;
      case 'tdspayable': return `/api/reports/tdspayable?${range}`;
      case 'statement': return party ? `/api/reports/statement?${range}&party=${party}` : '';
      case 'gst': return `/api/reports/gst-summary?period=${month}`;
      case 'gstr3b': return `/api/reports/gstr3b?period=${month}`;
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

  const monthly = tab === 'gst' || tab === 'gstr3b' || tab === 'gstr1';
  const csvHref = query && ['sales', 'customers', 'items', 'months', 'pnl', 'payables', 'payments', 'ageing', 'statement', 'tds', 'tdspayable'].includes(tab) ? `${query}${query.includes('?') ? '&' : '?'}format=csv` : '';
  const xlsxHref = csvHref && tab !== 'ageing' ? csvHref.replace(/format=csv$/, 'format=xlsx') : '';

  return (
    <>
      <div className="toolbar"><h1>Reports</h1>
        <div className="row" style={{ flex: 'none' }}>
          {csvHref && canExport && <a className="btn secondary" href={csvHref}>Download CSV</a>}
          {xlsxHref && canExport && <a className="btn secondary" href={xlsxHref}>Download Excel</a>}
          <button type="button" className="secondary no-print" onClick={() => window.print()}>Print</button>
          {tab === 'gstr1' && canExport && <a className="btn secondary" href={`/api/reports/gstr1?period=${month}&download=1`}>Download GSTR-1 JSON</a>}
          {tab === 'gstr3b' && canExport && <a className="btn secondary" href={`/api/reports/gstr3b?period=${month}&download=1`}>Download GSTR-3B JSON</a>}
        </div>
      </div>
      <div className="row no-print" style={{ marginBottom: 12, justifyContent: 'flex-start', alignItems: 'flex-end' }} aria-label="Saved views">
        {views.length > 0 && (<div><label htmlFor="rv">Saved views</label>
          <select id="rv" value="" onChange={(e) => { const v = views.find((x) => x.name === e.target.value); if (v) { setTab(v.tab); setFrom(v.from); setTo(v.to); setParty(v.party); } }}>
            <option value="">Open a saved view</option>{views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select></div>)}
        <div><label htmlFor="rn">Save this view as</label><input id="rn" value={viewName} maxLength={40} onChange={(e) => setViewName(e.target.value)} /></div>
        <button type="button" className="secondary" style={{ flex: 'none' }} disabled={!viewName.trim()} onClick={() => { keepViews([...views.filter((v) => v.name !== viewName.trim()), { name: viewName.trim(), tab, from, to, party }].slice(-12)); setViewName(''); }}>Save view</button>
        {views.length > 0 && <button type="button" className="link" style={{ flex: 'none' }} onClick={() => keepViews([])}>Clear saved views</button>}
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
      {tab === 'statement' && party && canSend && (
        <div className="row" style={{ marginBottom: 16, justifyContent: 'flex-start' }}>
          {contacts.length > 0 && (
            <div><label htmlFor="rc">Send to</label>
              <select id="rc" value={contact} onChange={(e) => setContact(e.target.value)}>
                <option value="">The customer&apos;s own email</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_primary ? ' (primary)' : ''} &middot; {c.email}</option>)}
              </select></div>)}
          <button type="button" className="secondary" style={{ flex: 'none', marginTop: 0 }} onClick={() => void sendStatement()}>Email this statement</button>
        </div>)}
      {sent && <p className="ok" role="status">{sent}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <KoraLoader />}

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
      {tab === 'tds' && data && (
        <>
          <p className="muted">Tax your customers deduct before paying you, for invoices dated in this period. Record the deduction as a payment of the kind &ldquo;TDS deducted by customer&rdquo; when the certificate arrives, and it moves from Still to receive to Received.</p>
          <table className="t" aria-label="TDS deducted by customers"><thead><tr><th>Customer</th><th>GSTIN</th><th className="n">Invoices</th><th className="n">Expected</th><th className="n">Received</th><th className="n">Still to receive</th></tr></thead>
            <tbody>{data.rows.length === 0 ? <tr><td colSpan={6} className="muted">No invoices with TDS in this period.</td></tr> : data.rows.map((r: any, i: number) => <tr key={i}><td>{r.customer}</td><td>{r.gstin}</td><td className="n">{r.invoices}</td><td className="n">{rupees(r.expected)}</td><td className="n">{rupees(r.received)}</td><td className="n"><b>{rupees(r.pending)}</b></td></tr>)}
              {data.rows.length > 0 && <tr><td colSpan={3}><b>Total</b></td><td className="n"><b>{rupees(data.totals.expected)}</b></td><td className="n"><b>{rupees(data.totals.received)}</b></td><td className="n"><b>{rupees(data.totals.pending)}</b></td></tr>}</tbody></table>
        </>
      )}
      {tab === 'tdspayable' && data && (
        <>
          <p className="muted">Tax you held back when paying vendors, by vendor and section. Deposit it with the government by the date shown, and file your TDS return from these figures. Your CA will confirm the rates and due dates for your case.</p>
          <table className="t" aria-label="TDS payable by vendor"><thead><tr><th>Vendor</th><th>PAN</th><th>Section</th><th className="n">Payments</th><th className="n">Paid to vendor</th><th className="n">TDS held back</th></tr></thead>
            <tbody>{data.rows.length === 0 ? <tr><td colSpan={6} className="muted">No tax held back in this period.</td></tr> : data.rows.map((r: any, i: number) => <tr key={i}><td>{r.vendor}</td><td>{r.pan}</td><td>{r.section}{r.sectionName ? ` (${r.sectionName})` : ''}</td><td className="n">{r.payments}</td><td className="n">{rupees(r.paid)}</td><td className="n"><b>{rupees(r.tds)}</b></td></tr>)}
              {data.rows.length > 0 && <tr><td colSpan={5}><b>Total to deposit</b></td><td className="n"><b>{rupees(data.total)}</b></td></tr>}</tbody></table>
          {data.deposits.length > 0 && (
            <table className="t" aria-label="TDS deposit dates" style={{ marginTop: 16 }}><thead><tr><th>Month paid</th><th>Section</th><th className="n">To deposit</th><th>Deposit by</th></tr></thead>
              <tbody>{data.deposits.map((d: any, i: number) => <tr key={i}><td>{d.month}</td><td>{d.section}</td><td className="n">{rupees(d.tds)}</td><td>{d.depositBy}</td></tr>)}</tbody></table>)}
        </>
      )}
      {tab === 'items' && data && (
        <table className="t" aria-label="Sales by item"><thead><tr><th>Item</th><th>HSN or SAC</th><th className="n">Quantity</th><th className="n">Taxable value</th><th className="n">Tax</th><th className="n">Total</th></tr></thead>
          <tbody>{data.rows.length === 0 ? <tr><td colSpan={6} className="muted">No sales in this period.</td></tr> : data.rows.map((r: any) => <tr key={r.item}><td>{r.item}</td><td>{r.hsn_sac}</td><td className="n">{Number(r.quantity)}</td><td className="n">{rupees(r.taxable)}</td><td className="n">{rupees(r.tax)}</td><td className="n">{rupees(r.total)}</td></tr>)}
            {data.rows.length > 0 && <tr><td colSpan={3}><b>Total</b></td><td className="n"><b>{rupees(data.totals.taxable)}</b></td><td colSpan={2} /></tr>}</tbody></table>
      )}
      {tab === 'months' && data && (
        <table className="t" aria-label="Sales by month"><thead><tr><th>Month</th><th className="n">Documents</th><th className="n">Taxable value</th><th className="n">Tax</th><th className="n">Total</th></tr></thead>
          <tbody>{data.rows.length === 0 ? <tr><td colSpan={5} className="muted">No sales in this period.</td></tr> : data.rows.map((r: any) => <tr key={r.month}><td>{r.month}</td><td className="n">{r.documents}</td><td className="n">{rupees(r.taxable)}</td><td className="n">{rupees(r.tax)}</td><td className="n">{rupees(r.total)}</td></tr>)}
            {data.rows.length > 0 && <tr><td><b>Total</b></td><td className="n"><b>{data.totals.documents}</b></td><td className="n"><b>{rupees(data.totals.taxable)}</b></td><td className="n"><b>{rupees(data.totals.tax)}</b></td><td className="n"><b>{rupees(data.totals.total)}</b></td></tr>}</tbody></table>
      )}
      {tab === 'pnl' && data && (
        <>
          <p className="muted">A quick guide on what you billed and bought in this period, before GST. It is not a set of accounts.</p>
          <table className="t" aria-label="Profit and loss"><thead><tr><th>Line</th><th className="n">Amount</th></tr></thead>
            <tbody>{data.rows.map((r: any, i: number) => <tr key={i} style={r.kind === 'result' ? { fontWeight: 700 } : undefined}><td style={r.indent ? { paddingLeft: 28 } : undefined}>{r.line}</td><td className="n" data-testid={r.line === 'Net profit' ? 'pnl-net' : undefined}>{BigInt(r.amount) < 0n ? `- ${rupees((-BigInt(r.amount)).toString())}` : rupees(r.amount)}</td></tr>)}</tbody></table>
        </>
      )}
      {tab === 'payables' && data && (
        <>
          <p className="muted">Bills you have not fully paid, oldest first. Owed in total: <b>{rupees(data.outstanding)}</b>.</p>
          <table className="t" aria-label="Who you owe"><thead><tr><th>Vendor</th><th>Bill</th><th>Due</th><th className="n">Days late</th><th className="n">Owed</th></tr></thead>
            <tbody>{data.rows.length === 0 ? <tr><td colSpan={5} className="muted">You owe nothing.</td></tr> : data.rows.map((r: any, i: number) => <tr key={i}><td>{r.vendor}</td><td>{r.bill_number}</td><td>{r.due_date}</td><td className="n">{r.days_late || ''}</td><td className="n">{rupees(r.due_paise)}</td></tr>)}</tbody></table>
        </>
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
      {tab === 'gstr3b' && data && (
        <>
          <table className="t"><thead><tr><th>3.1 Outward supplies</th><th className="n">Taxable value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th></tr></thead>
            <tbody>{data.table31.map((r: any) => <tr key={r.label}><td>{r.label}</td><td className="n">{rupees(r.taxable)}</td><td className="n">{rupees(r.igst)}</td><td className="n">{rupees(r.cgst)}</td><td className="n">{rupees(r.sgst)}</td><td className="n">{rupees(r.cess)}</td></tr>)}
              <tr><td><b>Tax payable before input credit</b></td><td /><td className="n"><b>{rupees(data.liability.igst)}</b></td><td className="n"><b>{rupees(data.liability.cgst)}</b></td><td className="n"><b>{rupees(data.liability.sgst)}</b></td><td className="n"><b>{rupees(data.liability.cess)}</b></td></tr></tbody></table>
          <h3 style={{ marginTop: 16 }}>3.2 Inter-state supplies to buyers without a GSTIN</h3>
          {data.table32.length === 0 ? <p className="muted">None this month.</p> : (
            <table className="t"><thead><tr><th>Place of supply</th><th className="n">Taxable value</th><th className="n">IGST</th></tr></thead>
              <tbody>{data.table32.map((r: any) => <tr key={r.pos}><td>{STATE_NAMES[r.pos] ?? r.pos}</td><td className="n">{rupees(r.taxable)}</td><td className="n">{rupees(r.igst)}</td></tr>)}</tbody></table>)}
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
