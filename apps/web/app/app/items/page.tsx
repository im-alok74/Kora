'use client';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees, TAX_RATES } from '../../../lib/client';

type Item = {
  id: string; name: string; kind: string; hsn_sac: string | null; unit: string; default_rate_bp: number; price_paise: string; price_includes_tax: boolean;
  track_stock: boolean; barcode: string | null; reorder_milli: string | null; qty_milli: string | null;
};
type Move = { id: string; qty_milli: string; kind: string; note: string | null; occurred_on: string; invoice_number: string | null; bill_number: string | null };
const EMPTY = { name: '', kind: 'goods', hsnSac: '', unit: 'NOS', defaultRateBp: 1800, price: '', priceIncludesTax: false, trackStock: false, barcode: '', reorderLevel: '' };
const KIND: Record<string, string> = { opening: 'Opening stock', purchase: 'Bought', purchase_cancelled: 'Purchase cancelled', sale: 'Sold', sale_cancelled: 'Sale cancelled', adjustment: 'Adjusted' };
const qty = (m: string | null) => { if (m === null) return ''; const n = BigInt(m); const neg = n < 0n; const a = neg ? -n : n; const whole = a / 1000n; const frac = (a % 1000n).toString().padStart(3, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`; };

export default function Items() {
  const [rows, setRows] = useState<Item[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<{ item: Item; moves: Move[] } | null>(null);
  const [adj, setAdj] = useState({ mode: 'in', quantity: '', note: '' });
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api(`/api/items${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => setRows(r.items)).catch((e) => setErr(e.message)), [q]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); }, []);
  const canWrite = role === 'owner' || role === 'staff';

  const openStock = async (item: Item) => { setStock({ item, moves: (await api(`/api/stock/${item.id}`)).movements }); setAdj({ mode: 'in', quantity: '', note: '' }); };

  return (
    <>
      <div className="toolbar">
        <div><h1>Items</h1><p className="page-sub">What you sell, with its GST rate and price. Turn on stock for goods you count.</p></div>
        {canWrite && <button onClick={() => { setOpen((v) => !v); setEditing(null); setForm(EMPTY); }}><Icon name="plus" size={18} />Add an item</button>}
      </div>

      {(open || editing) && canWrite && (
        <form className="panel" onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          try {
            const body = { name: form.name, kind: form.kind, hsnSac: form.hsnSac || null, unit: form.unit, defaultRateBp: form.defaultRateBp, price: form.price || undefined,
              priceIncludesTax: form.priceIncludesTax, trackStock: form.trackStock && form.kind === 'goods', barcode: form.barcode || null, reorderLevel: form.reorderLevel || null };
            await api(editing ? `/api/items/${editing}` : '/api/items', { method: editing ? 'PUT' : 'POST', body });
            setForm(EMPTY); setEditing(null); setOpen(false); await load();
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
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={form.priceIncludesTax} onChange={(e) => setForm({ ...form, priceIncludesTax: e.target.checked })} /> The price already includes GST (an MRP)</label>
          {form.kind === 'goods' && (<>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} /> Keep count of stock for this item</label>
            <div className="row">
              <div><label htmlFor="ib">Barcode (optional)</label><input id="ib" value={form.barcode} maxLength={60} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
              {form.trackStock && <div><label htmlFor="il">Tell me when it falls to</label><input id="il" inputMode="decimal" value={form.reorderLevel} placeholder="For example, 5" onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></div>}
            </div></>)}
          <button style={{ marginTop: 12 }}>{editing ? 'Save changes' : 'Add item'}</button>
          {(editing || open) && <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setOpen(false); setForm(EMPTY); }}>Cancel</button>}
          {err && <p className="error" role="alert">{err}</p>}
        </form>
      )}
      {!open && !editing && err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <div className="filters"><div style={{ flex: 1 }}><label htmlFor="iq">Search</label><input id="iq" type="search" placeholder="Name or barcode" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>

      {rows === null && <p className="muted" role="status">Loading</p>}
      {rows && rows.length === 0 && <div className="panel empty"><Icon name="box" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No items yet.</h3><p>Add what you sell so invoices fill in the HSN code and GST rate for you.</p></div>}
      {rows && rows.length > 0 && (
        <table className="t" aria-label="Items">
          <thead><tr><th>Name</th><th>HSN/SAC</th><th>GST</th><th className="n">Price</th><th className="n">In stock</th><th /></tr></thead>
          <tbody>{rows.map((i) => {
            const low = i.track_stock && i.reorder_milli !== null && i.qty_milli !== null && BigInt(i.qty_milli) <= BigInt(i.reorder_milli);
            return (
              <tr key={i.id}>
                <td>{i.name}{i.barcode && <><br /><span className="muted" style={{ fontSize: 12.5 }}>{i.barcode}</span></>}</td><td>{i.hsn_sac ?? ''}</td><td>{i.default_rate_bp / 100}%</td>
                <td className="n">{rupees(i.price_paise)}{i.price_includes_tax && <span className="muted" style={{ fontSize: 12 }}> incl.</span>}</td>
                <td className="n">{i.track_stock ? <>{qty(i.qty_milli)} {i.unit}{low && <> <span className="chip cancelled">Low</span></>}</> : <span className="muted">Not counted</span>}</td>
                <td className="n">{i.track_stock && <button className="link" onClick={() => openStock(i)}>Stock</button>}{' '}
                  {canWrite && <button className="link" onClick={() => { setOpen(false); setEditing(i.id); setForm({ name: i.name, kind: i.kind, hsnSac: i.hsn_sac ?? '', unit: i.unit, defaultRateBp: i.default_rate_bp, price: (BigInt(i.price_paise) / 100n).toString() + (BigInt(i.price_paise) % 100n === 0n ? '' : `.${(BigInt(i.price_paise) % 100n).toString().padStart(2, '0')}`), priceIncludesTax: i.price_includes_tax, trackStock: i.track_stock, barcode: i.barcode ?? '', reorderLevel: i.reorder_milli === null ? '' : qty(i.reorder_milli) }); window.scrollTo({ top: 0 }); }}>Edit</button>}{' '}
                  {canWrite && <button className="link" onClick={async () => { await api(`/api/items/${i.id}`, { method: 'DELETE' }); await load(); }}>Archive</button>}</td>
              </tr>);
          })}</tbody>
        </table>)}

      {stock && (
        <div className="panel" aria-label={`Stock of ${stock.item.name}`} style={{ marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center' }}><h2 style={{ margin: 0 }}>{stock.item.name}: {qty(stock.item.qty_milli)} {stock.item.unit} in stock</h2><button className="secondary sm" style={{ flex: 'none' }} onClick={() => setStock(null)}>Close</button></div>
          {canWrite && (
            <form onSubmit={async (e) => {
              e.preventDefault(); setErr(''); setMsg('');
              try { const r = await api(`/api/stock/${stock.item.id}`, { body: adj }); setMsg(r.changed ? `Stock is now ${qty(r.qtyMilli)} ${stock.item.unit}.` : 'Nothing changed.'); await load(); const fresh = (await api(`/api/items?q=${encodeURIComponent(stock.item.name)}`)).items.find((x: Item) => x.id === stock.item.id) as Item; setStock({ item: fresh ?? stock.item, moves: (await api(`/api/stock/${stock.item.id}`)).movements }); setAdj({ mode: adj.mode, quantity: '', note: '' }); }
              catch (x) { setErr((x as Error).message); }
            }}>
              <div className="row">
                <div><label htmlFor="sm" style={{ marginTop: 0 }}>What happened</label><select id="sm" value={adj.mode} onChange={(e) => setAdj({ ...adj, mode: e.target.value })}><option value="in">Stock came in</option><option value="out">Stock went out</option><option value="count">I counted it</option></select></div>
                <div><label htmlFor="sq" style={{ marginTop: 0 }}>{adj.mode === 'count' ? 'Counted quantity' : 'Quantity'}</label><input id="sq" inputMode="decimal" value={adj.quantity} onChange={(e) => setAdj({ ...adj, quantity: e.target.value })} required /></div>
                <div style={{ flex: 2 }}><label htmlFor="sn" style={{ marginTop: 0 }}>Why{adj.mode === 'count' ? ' (optional)' : ''}</label><input id="sn" value={adj.note} maxLength={300} placeholder="Customer return, damaged, opening stock" onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></div>
              </div>
              <button style={{ marginTop: 10 }}>Save</button>
            </form>)}
          <table className="t" aria-label="Stock history" style={{ marginTop: 14 }}>
            <thead><tr><th>Date</th><th>What</th><th>Note</th><th className="n">Quantity</th></tr></thead>
            <tbody>{stock.moves.map((m) => (<tr key={m.id}><td>{m.occurred_on}</td><td>{KIND[m.kind] ?? m.kind}{m.invoice_number ? ` ${m.invoice_number}` : m.bill_number ? ` ${m.bill_number}` : ''}</td><td>{m.note ?? ''}</td><td className="n">{BigInt(m.qty_milli) > 0n ? '+' : ''}{qty(m.qty_milli)}</td></tr>))}</tbody>
          </table>
        </div>)}
    </>
  );
}
