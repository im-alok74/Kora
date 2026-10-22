'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees } from '../../../lib/client';

type List = { id: string; name: string; kind: 'fixed' | 'percentage'; markup_bp: number | null; rounding: 'paise' | 'rupee'; entries: number; customers: number };
type Entry = { id: string; item_id: string; item_name: string; unit: string; item_price_paise: string; price_paise: string; price_includes_tax: boolean | null; item_price_includes_tax: boolean };
type Detail = List & { entries: Entry[] };
type Item = { id: string; name: string; price_paise: string };

const EMPTY = { name: '', kind: 'fixed', percent: '', rounding: 'paise' };

/** "-5" -> -500, "12.5" -> 1250. Two decimals at most. Returns null when the text is not a percentage. */
const pctToBp = (s: string): number | null => {
  const m = /^(-?)(\d{1,4})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -n : n;
};
const bpToPct = (bp: number) => `${bp < 0 ? '-' : ''}${Math.floor(Math.abs(bp) / 100)}${Math.abs(bp) % 100 ? `.${String(Math.abs(bp) % 100).padStart(2, '0').replace(/0$/, '')}` : ''}`;
const describe = (l: { kind: string; markup_bp: number | null }) =>
  l.kind === 'fixed' ? 'Fixed prices' : (l.markup_bp ?? 0) < 0 ? `${bpToPct(-(l.markup_bp ?? 0))}% off item prices` : `${bpToPct(l.markup_bp ?? 0)}% over item prices`;

export default function PriceLists() {
  const [rows, setRows] = useState<List[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [ef, setEf] = useState({ itemId: '', price: '', tax: 'item' });
  const load = useCallback(() => api('/api/price-lists').then((r) => setRows(r.priceLists)).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); api('/api/business').then((b) => setRole(b.role)); api('/api/items').then((r) => setItems(r.items)).catch(() => {}); }, [load]);
  const canWrite = role === 'owner' || role === 'staff';
  const openList = async (id: string) => { setErr(''); setDetail((await api(`/api/price-lists/${id}`)).priceList); setEf({ itemId: '', price: '', tax: 'item' }); };
  const run = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); } catch (x) { setErr((x as Error).message); } };

  return (
    <>
      <div className="toolbar">
        <div><h1>Price lists</h1><p className="page-sub">Different prices for different customers. Give a customer a list and invoices pick up its prices; anything the list does not cover uses the item&apos;s own price.</p></div>
        {canWrite && <button onClick={() => { setOpen((v) => !v); setEditing(null); setForm(EMPTY); }}><Icon name="plus" size={18} />Add a price list</button>}
      </div>

      {(open || editing) && canWrite && (
        <form className="panel" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const markupBp = form.kind === 'percentage' ? pctToBp(form.percent) : null;
            if (form.kind === 'percentage' && markupBp === null) throw new Error('Enter the markup or discount as a percentage, such as 10 or -5.');
            const body = { name: form.name, kind: form.kind, markupBp, rounding: form.rounding };
            await api(editing ? `/api/price-lists/${editing}` : '/api/price-lists', { method: editing ? 'PUT' : 'POST', body });
            setForm(EMPTY); setEditing(null); setOpen(false); await load();
            if (detail && editing === detail.id) await openList(editing);
          });
        }}>
          <h2>{editing ? 'Edit price list' : 'Add a price list'}</h2>
          <div className="row">
            <div><label htmlFor="pn">Name</label><input id="pn" value={form.name} placeholder="Wholesale" onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label htmlFor="pk">Kind</label><select id="pk" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="fixed">A price for each item</option><option value="percentage">A percentage over item prices</option></select></div>
            {form.kind === 'percentage' && <>
              <div><label htmlFor="pp">Percentage (negative for a discount)</label><input id="pp" inputMode="decimal" value={form.percent} placeholder="-10" onChange={(e) => setForm({ ...form, percent: e.target.value })} required /></div>
              <div><label htmlFor="pr">Round to</label><select id="pr" value={form.rounding} onChange={(e) => setForm({ ...form, rounding: e.target.value })}><option value="paise">The nearest paisa</option><option value="rupee">The nearest rupee</option></select></div>
            </>}
          </div>
          <button style={{ marginTop: 12 }}>{editing ? 'Save changes' : 'Add price list'}</button>
          <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setOpen(false); setForm(EMPTY); }}>Cancel</button>
        </form>
      )}
      {err && <p className="error" role="alert">{err}</p>}

      {rows === null && <KoraLoader />}
      {rows && rows.length === 0 && <div className="panel empty"><Icon name="percent" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No price lists yet.</h3><p>Add one for wholesale, distributors or any customer who gets their own prices.</p></div>}
      {rows && rows.length > 0 && (
        <table className="t" aria-label="Price lists">
          <thead><tr><th>Name</th><th>How it prices</th><th className="n">Items listed</th><th className="n">Customers</th><th /></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.id}>
              <td><button className="link" onClick={() => void run(() => openList(l.id))}>{l.name}</button></td>
              <td>{describe(l)}{l.kind === 'percentage' && l.rounding === 'rupee' && <span className="muted"> · whole rupees</span>}</td>
              <td className="n">{l.entries}</td><td className="n">{l.customers}</td>
              <td className="n">{canWrite && <>
                <button className="link" onClick={() => { setOpen(false); setEditing(l.id); setForm({ name: l.name, kind: l.kind, percent: l.markup_bp === null ? '' : bpToPct(l.markup_bp), rounding: l.rounding }); window.scrollTo({ top: 0 }); }}>Edit</button>{' '}
                <button className="link" onClick={() => void run(async () => { await api(`/api/price-lists/${l.id}`, { method: 'DELETE' }); if (detail?.id === l.id) setDetail(null); await load(); })}>Archive</button></>}</td>
            </tr>))}</tbody>
        </table>)}

      {detail && (
        <div className="panel" aria-label={`Prices on ${detail.name}`} style={{ marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center' }}><h2 style={{ margin: 0 }}>{detail.name}: {describe(detail)}</h2><button className="secondary sm" style={{ flex: 'none' }} onClick={() => setDetail(null)}>Close</button></div>
          <p className="muted">{detail.kind === 'percentage' ? 'Items below are priced as written. Every other item takes the percentage over its own price.' : 'Items not listed here use their own price.'}</p>
          {detail.entries.length > 0 && (
            <table className="t" aria-label="Prices on this list">
              <thead><tr><th>Item</th><th className="n">Item price</th><th className="n">On this list</th><th /></tr></thead>
              <tbody>{detail.entries.map((e) => (
                <tr key={e.id}><td>{e.item_name}</td><td className="n">{rupees(e.item_price_paise)}</td>
                  <td className="n">{rupees(e.price_paise)}{(e.price_includes_tax ?? e.item_price_includes_tax) && <span className="muted" style={{ fontSize: 12 }}> incl.</span>}</td>
                  <td className="n">{canWrite && <button className="link" onClick={() => void run(async () => { await api(`/api/price-lists/${detail.id}/items/${e.item_id}`, { method: 'DELETE' }); await openList(detail.id); await load(); })}>Remove</button>}</td></tr>))}</tbody>
            </table>)}
          {canWrite && (
            <form onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/api/price-lists/${detail.id}/items`, { body: { itemId: ef.itemId, price: ef.price, priceIncludesTax: ef.tax === 'item' ? null : ef.tax === 'yes' } });
                setEf({ itemId: '', price: '', tax: 'item' }); await openList(detail.id); await load();
              });
            }}>
              <h3 style={{ marginTop: 16 }}>Set a price</h3>
              <div className="row">
                <div><label htmlFor="ei">Item</label><select id="ei" value={ef.itemId} onChange={(e) => setEf({ ...ef, itemId: e.target.value })} required><option value="">Choose an item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({rupees(i.price_paise)})</option>)}</select></div>
                <div><label htmlFor="ep">Price (Rs)</label><input id="ep" inputMode="decimal" value={ef.price} onChange={(e) => setEf({ ...ef, price: e.target.value })} required /></div>
                <div><label htmlFor="et">GST</label><select id="et" value={ef.tax} onChange={(e) => setEf({ ...ef, tax: e.target.value })}><option value="item">As the item says</option><option value="yes">Price includes GST</option><option value="no">GST on top</option></select></div>
                <button>Save price</button>
              </div>
            </form>)}
        </div>)}
    </>
  );
}
