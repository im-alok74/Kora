'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@kora/tax';
import { api, DOC_LABEL, rupees } from '../../../lib/client';

type Invoice = { id: string; doc_type: string; number: string; doc_date: string; due_date: string | null; grand_total_paise: string; outstanding_paise: string; payment_status: string; overdue: boolean };
type Estimate = { id: string; number: string; doc_date: string; valid_until: string | null; grand_total_paise: string; status: string; currency: string };
type Overview = {
  business: { name: string; gstin: string | null; phone: string | null; email: string | null }; customer: { name: string };
  totals: { outstanding: string; overdue: string }; invoices: Invoice[]; estimates: Estimate[]; payments: { method: string; amount_paise: string; received_on: string }[];
};
type Statement = { from: string; to: string; opening: string; closing: string; rows: { date: string; description: string; debit: string; credit: string; balance: string }[] };

const EST: Record<string, string> = { open: 'Waiting for your answer', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', invoiced: 'Accepted and invoiced' };
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', netbanking: 'Net banking', tds: 'TDS deducted', other: 'Other' };

export default function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Overview | null>(null);
  const [dead, setDead] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stmt, setStmt] = useState<Statement | null>(null);

  const load = useCallback(async () => {
    try { setData(await api(`/api/portal/${token}`)); } catch (e) { setDead(true); setErr((e as Error).message); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const loadStatement = useCallback(async () => {
    const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to);
    try { setStmt(await api(`/api/portal/${token}/statement?${q}`)); } catch (e) { setErr((e as Error).message); }
  }, [token, from, to]);
  useEffect(() => { if (data) void loadStatement(); }, [data, loadStatement]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setErr(''); setMsg(''); setBusy(key);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  if (dead) return <main><h1>This link is not valid</h1><p className="muted">{err || 'Ask the business that sent it for a new link.'}</p></main>;
  if (!data) return <main><p className="muted">Loading</p></main>;
  const owing = BigInt(data.totals.outstanding) > 0n;
  const query = `${from ? `from=${from}&` : ''}${to ? `to=${to}&` : ''}`;

  return (
    <div className="portal">
      <header className="portal-head">
        <div>
          <div className="muted">Account with</div>
          <h1 style={{ margin: 0 }}>{data.business.name}</h1>
          <div className="muted">For {data.customer.name}</div>
        </div>
        <div className="muted portal-contact">
          {data.business.phone && <div>{data.business.phone}</div>}
          {data.business.email && <div>{data.business.email}</div>}
          {data.business.gstin && <div>GSTIN {data.business.gstin}</div>}
        </div>
      </header>

      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <section className="portal-cards" aria-label="Summary">
        <div className="panel"><div className="muted">You owe</div><div className="portal-big" data-testid="portal-owing">{rupees(data.totals.outstanding)}</div>
          {!owing && <div className="ok">You are all paid up. Thank you.</div>}</div>
        <div className="panel"><div className="muted">Overdue</div><div className={`portal-big${BigInt(data.totals.overdue) > 0n ? ' error' : ''}`} data-testid="portal-overdue">{rupees(data.totals.overdue)}</div></div>
      </section>

      {data.estimates.some((e) => e.status === 'open') && (
        <section className="panel" aria-label="Estimates to answer">
          <h2>Estimates waiting for you</h2>
          <table className="t"><thead><tr><th>Estimate</th><th>Date</th><th>Valid until</th><th className="n">Amount</th><th /></tr></thead>
            <tbody>{data.estimates.filter((e) => e.status === 'open').map((e) => (
              <tr key={e.id}>
                <td><a href={`/portal/${token}/open/${e.id}`} target="_blank" rel="noreferrer">{e.number}</a></td><td>{e.doc_date}</td><td>{e.valid_until ?? ''}</td>
                <td className="n">{e.currency === 'INR' ? rupees(e.grand_total_paise) : formatMoney(BigInt(e.grand_total_paise), e.currency)}</td>
                <td className="n">
                  <button disabled={!!busy} onClick={() => act(`a${e.id}`, async () => { await api(`/api/portal/${token}/estimate/${e.id}`, { body: { action: 'accept' } }); await load(); setMsg(`Thank you. ${e.number} is accepted.`); })}>Accept</button>{' '}
                  <button className="secondary" disabled={!!busy} onClick={() => act(`d${e.id}`, async () => { await api(`/api/portal/${token}/estimate/${e.id}`, { body: { action: 'decline' } }); await load(); setMsg(`${e.number} is declined.`); })}>Decline</button>
                </td>
              </tr>))}</tbody></table>
        </section>)}

      <section aria-label="Invoices">
        <h2>Invoices</h2>
        {data.invoices.length === 0 ? <div className="panel"><p>No invoices yet.</p></div> : (
          <table className="t"><thead><tr><th>Document</th><th>Date</th><th>Due</th><th className="n">Amount</th><th className="n">Balance</th><th /></tr></thead>
            <tbody>{data.invoices.map((i) => {
              const bal = BigInt(i.outstanding_paise);
              return (
                <tr key={i.id}>
                  <td><a href={`/portal/${token}/open/${i.id}`} target="_blank" rel="noreferrer">{i.number}</a> <span className="muted">{DOC_LABEL[i.doc_type]}</span></td>
                  <td>{i.doc_date}</td>
                  <td>{i.due_date ?? ''}{i.overdue && <> <span className="chip cancelled">Overdue</span></>}</td>
                  <td className="n">{rupees(i.grand_total_paise)}</td>
                  <td className="n">{bal > 0n ? rupees(i.outstanding_paise) : <span className="chip paid">Paid</span>}</td>
                  <td className="n">{bal > 0n && <button disabled={!!busy} aria-label={`Pay ${i.number}`}
                    onClick={() => act(`p${i.id}`, async () => { const r = await api(`/api/portal/${token}/pay/${i.id}`, { body: {} }); window.location.href = r.url; })}>Pay {rupees(i.outstanding_paise)}</button>}</td>
                </tr>);
            })}</tbody></table>)}
      </section>

      {data.estimates.some((e) => e.status !== 'open') && (
        <section aria-label="Earlier estimates">
          <h2>Earlier estimates</h2>
          <table className="t"><thead><tr><th>Estimate</th><th>Date</th><th className="n">Amount</th><th>Status</th></tr></thead>
            <tbody>{data.estimates.filter((e) => e.status !== 'open').map((e) => (
              <tr key={e.id}><td><a href={`/portal/${token}/open/${e.id}`} target="_blank" rel="noreferrer">{e.number}</a></td><td>{e.doc_date}</td><td className="n">{e.currency === 'INR' ? rupees(e.grand_total_paise) : formatMoney(BigInt(e.grand_total_paise), e.currency)}</td><td>{EST[e.status] ?? e.status}</td></tr>))}</tbody></table>
        </section>)}

      {data.payments.length > 0 && (
        <section aria-label="Payments">
          <h2>Payments we have received</h2>
          <table className="t"><thead><tr><th>Date</th><th>How</th><th className="n">Amount</th></tr></thead>
            <tbody>{data.payments.map((p, i) => <tr key={i}><td>{p.received_on}</td><td>{METHOD[p.method] ?? p.method}</td><td className="n">{rupees(p.amount_paise)}</td></tr>)}</tbody></table>
        </section>)}

      <section aria-label="Statement" className="portal-statement">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Statement</h2>
          <div className="row no-print" style={{ flex: 'none' }}>
            <div><label htmlFor="pf">From</label><input id="pf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label htmlFor="pt">To</label><input id="pt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <a className="btn secondary" href={`/api/portal/${token}/statement?${query}format=csv`}>Download CSV</a>
            <button className="secondary" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {stmt && (
          <table className="t"><thead><tr><th>Date</th><th>Description</th><th className="n">Billed</th><th className="n">Received or credited</th><th className="n">Balance</th></tr></thead>
            <tbody>
              <tr><td colSpan={4}>Opening balance ({stmt.from})</td><td className="n">{rupees(stmt.opening)}</td></tr>
              {stmt.rows.map((r, i) => (
                <tr key={i}><td>{r.date}</td><td>{r.description}</td><td className="n">{BigInt(r.debit) ? rupees(r.debit) : ''}</td><td className="n">{BigInt(r.credit) ? rupees(r.credit) : ''}</td><td className="n">{rupees(r.balance)}</td></tr>))}
              <tr><td colSpan={4}><b>Closing balance ({stmt.to})</b></td><td className="n"><b data-testid="portal-closing">{rupees(stmt.closing)}</b></td></tr>
            </tbody></table>)}
      </section>

      <footer className="muted portal-foot">This page is private to {data.customer.name}. Anyone with the link can see it, so do not share it.</footer>
    </div>
  );
}
