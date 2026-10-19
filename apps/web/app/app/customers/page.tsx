'use client';
import { useCallback, useEffect, useState } from 'react';
import { gstinValid, STATE_NAMES } from '@kora/tax';
import { api } from '../../../lib/client';

type Party = { id: string; name: string; gstin: string | null; state_code: string; phone: string | null; email: string | null; billing_address?: Record<string, string> };
const EMPTY = { name: '', gstin: '', stateCode: '', phone: '', email: '', line1: '', city: '', pincode: '' };

export default function Customers() {
  const [rows, setRows] = useState<Party[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(() => api(`/api/parties${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setRows(r.parties)), [q]);
  useEffect(() => { void load(); }, [load]);

  const g = form.gstin.trim().toUpperCase();
  const stateFromGstin = g.length >= 2 && STATE_NAMES[g.slice(0, 2)] ? g.slice(0, 2) : '';
  const state = stateFromGstin || form.stateCode;

  return (
    <>
      <h1>Customers</h1>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault(); setErr('');
        try {
          const body = { kind: 'customer', name: form.name, gstin: g || null, stateCode: state || null, phone: form.phone || null, email: form.email || null,
            billingAddress: { line1: form.line1, city: form.city, pincode: form.pincode } };
          await api(editing ? `/api/parties/${editing}` : '/api/parties', { method: editing ? 'PUT' : 'POST', body });
          setForm(EMPTY); setEditing(null); await load();
        } catch (x) { setErr((x as Error).message); }
      }}>
        <h2>{editing ? 'Edit customer' : 'Add a customer'}</h2>
        <div className="row">
          <div><label htmlFor="cn">Name</label><input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label htmlFor="cg">GSTIN</label><input id="cg" maxLength={15} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            {g.length === 15 && !gstinValid(g) && <div className="error">Not a valid GSTIN.</div>}</div>
          <div><label htmlFor="cs">State</label>
            <select id="cs" value={state} disabled={!!stateFromGstin} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
              <option value="">Choose a state</option>
              {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select></div>
        </div>
        <div className="row">
          <div><label htmlFor="cp">Mobile</label><input id="cp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label htmlFor="ce">Email</label><input id="ce" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        </div>
        <p className="muted">Address is needed for e-invoices to businesses.</p>
        <div className="row">
          <div><label htmlFor="cl">Address line 1</label><input id="cl" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></div>
          <div><label htmlFor="cc">City</label><input id="cc" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label htmlFor="cpn">Pincode</label><input id="cpn" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
        </div>
        <button>{editing ? 'Save changes' : 'Add customer'}</button>
        {editing && <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <label htmlFor="sq">Search</label><input id="sq" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
      <table className="t">
        <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Mobile</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td>{p.name}</td><td>{p.gstin ?? ''}</td><td>{STATE_NAMES[p.state_code]}</td><td>{p.phone ?? ''}</td>
            <td className="n"><button className="link" onClick={() => { setEditing(p.id); setForm({ name: p.name, gstin: p.gstin ?? '', stateCode: p.state_code, phone: p.phone ?? '', email: p.email ?? '', line1: p.billing_address?.line1 ?? '', city: p.billing_address?.city ?? '', pincode: p.billing_address?.pincode ?? '' }); window.scrollTo(0, 0); }}>Edit</button>{' '}
              <button className="link" onClick={async () => { await api(`/api/parties/${p.id}`, { method: 'DELETE' }); await load(); }}>Archive</button></td></tr>))}</tbody>
      </table>
    </>
  );
}
