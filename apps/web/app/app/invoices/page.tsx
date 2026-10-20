'use client';
import { useEffect, useState } from 'react';
import { formatMoney } from '@kora/tax';
import Icon from '../../../components/Icon';
import { api, DOC_LABEL, rupees } from '../../../lib/client';
import { isNetworkError, listDrafts, onDraftsChanged, type LocalDraft } from '../../../lib/offline';

type Row = { id: string; doc_type: string; status: string; number: string | null; doc_date: string; grand_total_paise: string;
  payment_status: string; party_name: string | null; einvoice_status: string; estimate_status?: string | null; currency?: string; due_date: string | null; amount_settled_paise: string };

const EST_LABEL: Record<string, string> = { draft: 'Draft', open: 'Open', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', invoiced: 'Invoiced', cancelled: 'Cancelled' };
const EST_CHIP: Record<string, string> = { draft: 'draft', open: 'issued', accepted: 'paid', declined: 'cancelled', expired: 'cancelled', invoiced: 'paid', cancelled: 'cancelled' };

export default function Documents() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const initial = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('type') ?? '';
  const [status, setStatus] = useState('');
  const [type, setType] = useState(Object.keys(DOC_LABEL).includes(initial) ? initial : '');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [role, setRole] = useState('');
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([]);
  const [offline, setOffline] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: 'number' | 'type' | 'party_name' | 'doc_date' | 'grand_total_paise' | 'status'; dir: 1 | -1 } | null>(null);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
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

  const canWrite = role !== 'accountant';
  const canIssue = role === 'owner' || role === 'staff';
  const sorted = rows && sort ? [...rows].sort((a, b) => {
    const av = sort.key === 'grand_total_paise' ? Number(a.grand_total_paise) : String(sort.key === 'status' ? a.status : (a as Record<string, unknown>)[sort.key] ?? '');
    const bv = sort.key === 'grand_total_paise' ? Number(b.grand_total_paise) : String(sort.key === 'status' ? b.status : (b as Record<string, unknown>)[sort.key] ?? '');
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  }) : rows;
  const today = new Date().toISOString().slice(0, 10);
  const owed = (r: Row) => (r.status === 'issued' && ['tax_invoice', 'bill_of_supply', 'debit_note'].includes(r.doc_type) && (!r.currency || r.currency === 'INR') ? BigInt(r.grand_total_paise) - BigInt(r.amount_settled_paise) : 0n);
  const late = (r: Row) => owed(r) > 0n && !!r.due_date && r.due_date < today;
  const outstanding = (rows ?? []).reduce((a, r) => a + owed(r), 0n);
  const overdue = (rows ?? []).filter(late).reduce((a, r) => a + owed(r), 0n);
  const draftCount = (rows ?? []).filter((r) => r.status === 'draft').length;
  const chosen = (rows ?? []).filter((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s0) => { const n = new Set(s0); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async (action: 'issue' | 'delete' | 'cancel' | 'remind', reason?: string) => {
    setBulkBusy(true); setBulkMsg(''); setErr('');
    try {
      const r = await api('/api/documents/bulk', { body: { action, ids: chosen.map((c) => c.id), reason, channel: 'whatsapp' } });
      const bad = (r.results as { ok: boolean; error?: string }[]).find((x) => !x.ok);
      setBulkMsg(`${r.done} done${r.failed ? `, ${r.failed} could not be done${bad?.error ? `: ${bad.error}` : ''}` : ''}.`);
      setPicked(new Set()); setCancelReason(null); setTick((n) => n + 1);
    } catch (e) { setErr((e as Error).message); } finally { setBulkBusy(false); }
  };
  const th = (label: string, key: NonNullable<typeof sort>['key'], right = false) => (
    <th className={right ? 'n' : undefined} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="thsort" onClick={() => setSort((c) => (c?.key === key ? (c.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }))}>{label}{sort?.key === key ? (sort.dir === 1 ? ' \u2191' : ' \u2193') : ''}</button>
    </th>);
  const tab = !type && !status ? 'all' : type === 'estimate' && !status ? 'estimates' : type === 'tax_invoice' && !status ? 'invoices' : status === 'draft' && !type ? 'drafts' : status === 'cancelled' && !type ? 'cancelled' : '';
  const pick = (t: string, s: string) => { setType(t); setStatus(s); };

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Documents</h1>
          <p className="page-sub">Invoices, estimates and the notes that correct them.</p>
        </div>
        {canWrite && <a className="btn" href="/app/invoices/new"><Icon name="plus" size={18} />New invoice</a>}
      </div>
      {rows && rows.length > 0 && (
        <div className="doc-stats" aria-label="Summary of the documents shown">
          <div><span className="k">Shown</span><b>{rows.length}</b></div>
          <div><span className="k">Outstanding</span><b>{rupees(outstanding)}</b></div>
          <div className={overdue > 0n ? 'owing' : ''}><span className="k">Overdue</span><b>{rupees(overdue)}</b></div>
          <div><span className="k">Drafts</span><b>{draftCount}</b></div>
        </div>
      )}
      <div className="tabs" role="group" aria-label="Quick filters">
        {([['all', 'All', '', ''], ['invoices', 'Tax invoices', 'tax_invoice', ''], ['estimates', 'Estimates', 'estimate', ''], ['drafts', 'Drafts', '', 'draft'], ['cancelled', 'Cancelled', '', 'cancelled']] as const).map(([k, label, t, st]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => pick(t, st)}>{label}</button>))}
      </div>
      <div className="filters">
        <div style={{ flex: 2 }}><label htmlFor="q">Search</label><input id="q" type="search" placeholder="Number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
          <p className="muted">These are waiting to sync. They go to Kora by themselves when you are back online.</p>
          <table className="t"><thead><tr><th>Customer</th><th className="n">Total</th><th>Status</th><th /></tr></thead>
            <tbody>{localDrafts.map((d) => (
              <tr key={d.localId}><td>{d.summary.customer}</td><td className="n">{d.summary.total ?? ''}</td>
                <td>{d.status === 'conflict' ? 'Changed on another device' : d.status === 'error' ? `Needs a fix: ${d.error}` : d.status === 'syncing' ? 'Syncing' : 'Waiting to sync'}</td>
                <td className="n"><a href={`/app/invoices/offline?d=${d.localId}`}>Open</a></td></tr>))}</tbody></table>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {rows === null && !err && <p className="muted" role="status">Loading</p>}
      {rows && rows.length === 0 && !offline && (
        <div className="panel empty">
          <Icon name="documents" size={34} style={{ color: 'var(--text-faint)' }} />
          {q || type || status ? <><h3>Nothing matches</h3><p>No documents match those filters. Try clearing them.</p><button className="secondary" onClick={() => { setQ(''); pick('', ''); }}>Clear filters</button></>
            : <><h3>No documents yet.</h3><p>Create an invoice and it will show up here.</p>{canWrite && <a className="btn" href="/app/invoices/new">Create your first invoice</a>}</>}
        </div>)}
      {bulkMsg && <p className="ok" role="status">{bulkMsg}</p>}
      {chosen.length > 0 && canIssue && (
        <div className="bulkbar" role="region" aria-label="Actions for the selected documents">
          <b>{chosen.length} selected</b>
          {chosen.every((c) => c.status === 'draft') && <button disabled={bulkBusy} onClick={() => bulk('issue')}>Issue</button>}
          {chosen.every((c) => c.status === 'draft') && <button className="danger" disabled={bulkBusy} onClick={() => bulk('delete')}>Delete drafts</button>}
          {chosen.every((c) => c.status === 'issued' && ['tax_invoice', 'bill_of_supply', 'debit_note'].includes(c.doc_type)) && <button className="secondary" disabled={bulkBusy} onClick={() => bulk('remind')}>Send reminders</button>}
          {chosen.every((c) => c.status === 'issued') && role === 'owner' && <button className="secondary" disabled={bulkBusy} onClick={() => setCancelReason(cancelReason === null ? '' : null)}>Cancel</button>}
          <button className="link" onClick={() => setPicked(new Set())}>Clear</button>
          {cancelReason !== null && (
            <form onSubmit={(e) => { e.preventDefault(); void bulk('cancel', cancelReason); }} style={{ display: 'flex', gap: 8, flex: '1 0 100%' }}>
              <input aria-label="Reason for cancelling" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancelling these" required />
              <button className="danger" disabled={bulkBusy}>Confirm cancel</button>
            </form>)}
        </div>)}
      {rows && rows.length > 0 && (
        <table className="t cards">
          <thead><tr><th aria-sort={sort?.key === 'number' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{canIssue && <input type="checkbox" aria-label="Select all documents" checked={rows.length > 0 && rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />} <button type="button" className="thsort" onClick={() => setSort((c) => (c?.key === 'number' ? (c.dir === 1 ? { key: 'number', dir: -1 } : null) : { key: 'number', dir: 1 }))}>Number{sort?.key === 'number' ? (sort.dir === 1 ? ' \u2191' : ' \u2193') : ''}</button></th>{th('Type', 'type')}{th('Customer', 'party_name')}{th('Date', 'doc_date')}<th>Due</th>{th('Total', 'grand_total_paise', true)}<th className="n">Balance</th>{th('Status', 'status')}</tr></thead>
          <tbody>{(sorted ?? rows).map((r) => (
            <tr key={r.id}>
              <td className="c-num">{canIssue && <input type="checkbox" aria-label={`Select ${r.number ?? 'draft'} for ${r.party_name ?? 'walk-in customer'}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />} <a href={`/app/invoices/${r.id}`}>{r.number ?? 'Draft'}</a></td>
              <td className="c-type">{DOC_LABEL[r.doc_type]}</td>
              <td className="c-cust">{r.party_name ?? 'Walk-in'}</td>
              <td className="c-date">{r.doc_date}</td>
              <td className="c-due">{r.due_date ?? ''}</td>
              <td className="n c-total">{r.currency && r.currency !== 'INR' ? formatMoney(BigInt(r.grand_total_paise), r.currency) : rupees(r.grand_total_paise)}</td>
              <td className="n c-bal">{owed(r) > 0n ? <span className={late(r) ? 'bad' : ''}>{rupees(owed(r))}</span> : ''}</td>
              <td className="c-status">{r.estimate_status ? <span className={`chip ${EST_CHIP[r.estimate_status] ?? 'issued'}`}>{EST_LABEL[r.estimate_status] ?? r.estimate_status}</span> : (
                <span className={`chip ${late(r) ? 'cancelled' : r.status === 'issued' && r.payment_status === 'paid' ? 'paid' : r.status === 'issued' && r.payment_status === 'part_paid' ? 'due' : r.status}`}>
                {late(r) ? 'Overdue' : r.status === 'issued' ? (r.payment_status === 'paid' ? 'Paid' : r.payment_status === 'part_paid' ? 'Part paid' : 'Issued') : r.status === 'draft' ? 'Draft' : 'Cancelled'}</span>)}</td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
