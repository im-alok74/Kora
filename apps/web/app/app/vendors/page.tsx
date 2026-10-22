'use client';
import { useCallback, useEffect, useState } from 'react';
import { gstinValid, STATE_NAMES } from '@kora/tax';
import { api, rupees } from '../../../lib/client';
import PartyTidy from '../../../components/PartyTidy';

type Vendor = { id: string; name: string; gstin: string | null; state_code: string; phone: string | null; email: string | null; udyam_number: string | null; msme_class: string | null };
type Due = { id: string; billNumber: string; vendor: string; deadline: string; duePaise: string; state: 'overdue' | 'soon' | 'ok'; daysLeft: number };
const EMPTY = { name: '', gstin: '', stateCode: '', phone: '', email: '', udyamNumber: '', msmeClass: '' };

/** The people you buy from. Micro and small vendors carry their Udyam number so Kora can warn before the 45-day limit. */
export default function Vendors() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([api(`/api/parties?kind=vendor${q ? `&q=${encodeURIComponent(q)}` : ''}`), api('/api/purchases/msme')]);
    setRows(p.parties); setDue(m.bills.filter((b: Due) => b.state !== 'ok'));
  }, [q]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const g = form.gstin.trim().toUpperCase();
  const stateFromGstin = g.length >= 2 && STATE_NAMES[g.slice(0, 2)] ? g.slice(0, 2) : '';
  const state = stateFromGstin || form.stateCode;

  return (
    <>
      <h1>Vendors</h1>
      <p className="page-sub">The people and firms you buy from. Record their bills under Purchases.</p>
      {due.length > 0 && (
        <div className="panel" role="region" aria-label="Micro and small vendors to pay" data-testid="msme-panel">
          <h2>Pay these on time</h2>
          <p className="muted">Micro and small suppliers should be paid within 45 days of the bill.</p>
          <table className="t cards" aria-label="MSME bills">
            <thead><tr><th>Vendor</th><th>Bill</th><th>Last day</th><th className="n">Owed</th><th>Status</th></tr></thead>
            <tbody>{due.map((b) => (
              <tr key={b.id}><td className="c-cust">{b.vendor}</td><td className="c-num"><a href={`/app/purchases/${b.id}`}>{b.billNumber}</a></td><td className="c-date">{b.deadline}</td>
                <td className="n c-total">{rupees(b.duePaise)}</td>
                <td className="c-status">{b.state === 'overdue' ? <span className="chip cancelled">Overdue by {-b.daysLeft} day{b.daysLeft === -1 ? '' : 's'}</span> : <span className="chip due">{b.daysLeft === 0 ? 'Due today' : `${b.daysLeft} days left`}</span>}</td></tr>))}</tbody>
          </table>
        </div>)}
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault(); setErr('');
        try {
          const body = { kind: 'vendor', name: form.name, gstin: g || null, stateCode: state || null, phone: form.phone || null, email: form.email || null,
            udyamNumber: form.udyamNumber.trim() || null, msmeClass: form.msmeClass || null };
          await api(editing ? `/api/parties/${editing}` : '/api/parties', { method: editing ? 'PUT' : 'POST', body });
          setForm(EMPTY); setEditing(null); await load();
        } catch (x) { setErr((x as Error).message); }
      }}>
        <h2>{editing ? 'Edit vendor' : 'Add a vendor'}</h2>
        <div className="row">
          <div><label htmlFor="vn">Name</label><input id="vn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label htmlFor="vg">GSTIN</label><input id="vg" maxLength={15} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            {g.length === 15 && !gstinValid(g) && <div className="error">Not a valid GSTIN.</div>}</div>
          <div><label htmlFor="vs">State</label>
            <select id="vs" value={state} disabled={!!stateFromGstin} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
              <option value="">Choose a state</option>
              {Object.entries(STATE_NAMES).filter(([c]) => !['97', '99', '96'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select></div>
        </div>
        <div className="row">
          <div><label htmlFor="vp">Mobile</label><input id="vp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label htmlFor="ve">Email</label><input id="ve" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        </div>
        <div className="row">
          <div><label htmlFor="vu">Udyam number (if they are an MSME)</label><input id="vu" placeholder="UDYAM-MH-12-0001234" value={form.udyamNumber} onChange={(e) => setForm({ ...form, udyamNumber: e.target.value })} /></div>
          <div><label htmlFor="vc">Size of enterprise</label>
            <select id="vc" value={form.msmeClass} onChange={(e) => setForm({ ...form, msmeClass: e.target.value })}>
              <option value="">Not an MSME</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option>
            </select></div>
        </div>
        <button>{editing ? 'Save changes' : 'Add vendor'}</button>
        {editing && <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <PartyTidy kind="vendor" canMerge onMerged={() => void load()} />
      <label htmlFor="vq">Search</label><input id="vq" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
      <table className="t cards" aria-label="Vendors">
        <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>MSME</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td className="c-cust"><a href={`/app/customers/${p.id}`}>{p.name}</a></td><td>{p.gstin ?? ''}</td><td>{STATE_NAMES[p.state_code] ?? p.state_code}</td>
            <td>{p.msme_class ? <span className="chip issued">{p.msme_class}</span> : ''}</td>
            <td className="n"><button className="link" onClick={() => { setEditing(p.id); setForm({ name: p.name, gstin: p.gstin ?? '', stateCode: p.state_code, phone: p.phone ?? '', email: p.email ?? '', udyamNumber: p.udyam_number ?? '', msmeClass: p.msme_class ?? '' }); window.scrollTo({ top: 0 }); }}>Edit</button>{' '}
              <button className="link" onClick={async () => { await api(`/api/parties/${p.id}`, { method: 'DELETE' }); await load(); }}>Archive</button></td></tr>))}</tbody>
      </table>
      {rows.length === 0 && <p className="muted">No vendors yet.</p>}
    </>
  );
}
