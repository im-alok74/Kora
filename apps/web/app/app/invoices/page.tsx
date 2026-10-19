'use client';
import { useEffect, useState } from 'react';
import { formatMoney } from '@kora/tax';
import { api, DOC_LABEL, rupees } from '../../../lib/client';
import { isNetworkError, listDrafts, onDraftsChanged, type LocalDraft } from '../../../lib/offline';

type Row = { id: string; doc_type: string; status: string; number: string | null; doc_date: string; grand_total_paise: string;
  payment_status: string; party_name: string | null; einvoice_status: string; estimate_status?: string | null; currency?: string };

const EST_LABEL: Record<string, string> = { draft: 'Draft', open: 'Open', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', invoiced: 'Invoiced', cancelled: 'Cancelled' };
const EST_CHIP: Record<string, string> = { draft: 'draft', open: 'issued', accepted: 'paid', declined: 'cancelled', expired: 'cancelled', invoiced: 'paid', cancelled: 'cancelled' };

export default function Documents() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [role, setRole] = useState('');
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([]);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0); // bumps when the connection returns or a draft syncs, so the list refetches
  useEffect(() => { const r = () => { void listDrafts().then(setLocalDrafts); setTick((n) => n + 1); }; r(); window.addEventListener('online', r); const off = onDraftsChanged(r); return () => { window.removeEventListener('online', r); off(); }; }, []);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (type) p.set('type', type);
    if (q) p.set('q', q);
    const h = setTimeout(() => api(`/api/documents?${p}`).then((r) => { setRows(r.documents); setOffline(false); }).catch((e) => { if (isNetworkError(e)) { setOffline(true); setRows([]); } else setErr(e.message); }), 150);
    return () => clearTimeout(h);
  }, [status, type, q, tick]);

  return (
    <>
      <div className="toolbar">
        <h1>Documents</h1>
        {role !== 'accountant' && <a className="btn" href="/app/invoices/new">New invoice</a>}
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div><label htmlFor="q">Search</label><input id="q" placeholder="Number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label htmlFor="ty">Type</label>
          <select id="ty" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>{Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label htmlFor="stt">Status</label>
          <select id="stt" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="cancelled">Cancelled</option>
          </select></div>
      </div>
      {offline && <p className="warn" role="status">You are offline. Showing only the drafts saved on this device.</p>}
      {localDrafts.length > 0 && (
        <div className="panel" data-testid="local-drafts">
          <h2>Saved on this device</h2>
          <table className="t"><thead><tr><th>Customer</th><th className="n">Total</th><th>Status</th><th /></tr></thead>
            <tbody>{localDrafts.map((d) => (
              <tr key={d.localId}><td>{d.summary.customer}</td><td className="n">{d.summary.total ?? ''}</td>
                <td>{d.status === 'conflict' ? 'Changed on another device' : d.status === 'error' ? `Needs a fix: ${d.error}` : d.status === 'syncing' ? 'Syncing' : 'Waiting to sync'}</td>
                <td className="n"><a href={`/app/invoices/offline?d=${d.localId}`}>Open</a></td></tr>))}</tbody></table>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {rows && rows.length === 0 && !offline && <div className="panel"><p>No documents yet.</p>{role !== 'accountant' && <a className="btn" href="/app/invoices/new">Create your first invoice</a>}</div>}
      {rows && rows.length > 0 && (
        <table className="t">
          <thead><tr><th>Number</th><th>Type</th><th>Customer</th><th>Date</th><th className="n">Total</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><a href={`/app/invoices/${r.id}`}>{r.number ?? 'Draft'}</a></td>
              <td>{DOC_LABEL[r.doc_type]}</td>
              <td>{r.party_name ?? 'Walk-in'}</td>
              <td>{r.doc_date}</td>
              <td className="n">{r.currency && r.currency !== 'INR' ? formatMoney(BigInt(r.grand_total_paise), r.currency) : rupees(r.grand_total_paise)}</td>
              <td>{r.estimate_status ? <span className={`chip ${EST_CHIP[r.estimate_status] ?? 'issued'}`}>{EST_LABEL[r.estimate_status] ?? r.estimate_status}</span> : (
                <span className={`chip ${r.status === 'issued' && r.payment_status === 'paid' ? 'paid' : r.status}`}>
                {r.status === 'issued' ? (r.payment_status === 'paid' ? 'Paid' : r.payment_status === 'part_paid' ? 'Part paid' : 'Issued') : r.status === 'draft' ? 'Draft' : 'Cancelled'}</span>)}</td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
