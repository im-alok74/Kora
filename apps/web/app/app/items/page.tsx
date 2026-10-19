'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees, TAX_RATES } from '../../../lib/client';

type Item = { id: string; name: string; kind: string; hsn_sac: string | null; unit: string; default_rate_bp: number; price_paise: string };
const EMPTY = { name: '', kind: 'goods', hsnSac: '', unit: 'NOS', defaultRateBp: 1800, price: '' };

export default function Items() {
  const [rows, setRows] = useState<Item[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/api/items').then((r) => setRows(r.items)), []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>Items</h1>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault(); setErr('');
        try {
          const body = { name: form.name, kind: form.kind, hsnSac: form.hsnSac || null, unit: form.unit, defaultRateBp: form.defaultRateBp, price: form.price || undefined };
          await api(editing ? `/api/items/${editing}` : '/api/items', { method: editing ? 'PUT' : 'POST', body });
          setForm(EMPTY); setEditing(null); await load();
        } catch (x) { setErr((x as Error).message); }
      }}>
        <h2>{editing ? 'Edit item' : 'Add an item'}</h2>
        <div className="row">
          <div><label htmlFor="in">Name</label><input id="in" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label htmlFor="ik">Type</label><select id="ik" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="goods">Goods</option><option value="service">Service</option></select></div>
          <div><label htmlFor="ih">HSN or SAC</label><input id="ih" inputMode="numeric" value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} /></div>
        </div>
        <div className="row">
          <div><label htmlFor="iu">Unit</label><input id="iu" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
          <div><label htmlFor="ir">GST rate</label><select id="ir" value={form.defaultRateBp} onChange={(e) => setForm({ ...form, defaultRateBp: Number(e.target.value) })}>{TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></div>
          <div><label htmlFor="ip">Price (Rs)</label><input id="ip" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        </div>
        <button>{editing ? 'Save changes' : 'Add item'}</button>
        {editing && <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <table className="t">
        <thead><tr><th>Name</th><th>HSN/SAC</th><th>GST</th><th className="n">Price</th><th /></tr></thead>
        <tbody>{rows.map((i) => (
          <tr key={i.id}><td>{i.name}</td><td>{i.hsn_sac ?? ''}</td><td>{i.default_rate_bp / 100}%</td><td className="n">{rupees(i.price_paise)}</td>
            <td className="n"><button className="link" onClick={() => { setEditing(i.id); setForm({ name: i.name, kind: i.kind, hsnSac: i.hsn_sac ?? '', unit: i.unit, defaultRateBp: i.default_rate_bp, price: (BigInt(i.price_paise) / 100n).toString() }); window.scrollTo(0, 0); }}>Edit</button>{' '}
              <button className="link" onClick={async () => { await api(`/api/items/${i.id}`, { method: 'DELETE' }); await load(); }}>Archive</button></td></tr>))}</tbody>
      </table>
    </>
  );
}
