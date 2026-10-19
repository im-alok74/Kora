'use client';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees, TAX_RATES } from '../../../lib/client';

type Received = { id: string; seller_name: string; seller_gstin: string; number: string; doc_date: string; due_date: string | null; taxable_paise: string; tax_paise: string; grand_total_paise: string; status: 'new' | 'accepted' | 'rejected'; seller_cancelled_at: string | null; bill_id: string | null; reason: string | null };
type Order = { id: string; po_number: string; po_date: string; expected_on: string | null; status: 'sent' | 'accepted' | 'declined' | 'cancelled'; buyer_name: string; seller_name: string; decline_reason: string | null; seller_document_id: string | null; line_count: number };
type Biz = { business_id: string; name: string; gstin: string; city: string | null; state_code: string; about: string | null; categories: string[]; items: number };
type CatItem = { name: string; kind: string; hsn_sac: string | null; unit: string; price_paise: string; price_includes_tax: boolean; default_rate_bp: number };
type Settings = { receive: boolean; hasGstin: boolean; listed: boolean; about: string; categories: string[]; city: string; listedItems: number };
type OLine = { name: string; hsnSac: string; unit: string; quantity: string; rate: string; taxRateBp: number };
const TABS = [['received', 'Invoices received'], ['orders', 'Orders'], ['directory', 'Directory'], ['listing', 'My listing']] as const;
const ORDER_CHIP = { sent: 'issued', accepted: 'paid', declined: 'cancelled', cancelled: 'cancelled' } as const;
const ORDER_LABEL = { sent: 'Sent', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled' } as const;

/** Businesses on Kora trading with each other: invoices arrive without retyping, and orders go the other way. */
export default function Network() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('received');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const [received, setReceived] = useState<Received[] | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [side, setSide] = useState<'received' | 'sent'>('received');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [declining, setDeclining] = useState<{ id: string; reason: string } | null>(null);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<Biz[] | null>(null);
  const [cat, setCat] = useState<{ seller: { id: string; name: string; gstin: string }; items: CatItem[] } | null>(null);
  const [po, setPo] = useState<{ sellerId: string; sellerName: string; lines: OLine[]; notes: string; expectedOn: string } | null>(null);
  const [st, setSt] = useState<Settings | null>(null);
  const [form, setForm] = useState({ about: '', city: '', categories: '' });

  const loadReceived = useCallback(async () => { setReceived((await api('/api/network/received')).invoices); }, []);
  const loadOrders = useCallback(async () => { setOrders((await api(`/api/network/orders?side=${side}`)).orders); }, [side]);
  const loadSettings = useCallback(async () => { const s = await api('/api/network/settings'); setSt(s); setForm({ about: s.about, city: s.city, categories: s.categories.join(', ') }); }, []);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); loadSettings().catch(() => {}); }, [loadSettings]);
  useEffect(() => { if (tab === 'received') loadReceived().catch((e) => setErr(e.message)); }, [tab, loadReceived]);
  useEffect(() => { if (tab === 'orders') loadOrders().catch((e) => setErr(e.message)); }, [tab, loadOrders]);
  useEffect(() => { if (tab === 'directory') { const h = setTimeout(() => api(`/api/network/directory?q=${encodeURIComponent(q)}`).then((r) => setDir(r.businesses)).catch((e) => setErr(e.message)), 200); return () => clearTimeout(h); } }, [tab, q]);

  const canBuy = role === 'owner' || role === 'staff' || role === 'accountant';
  const canSell = role === 'owner' || role === 'staff';
  const waiting = received?.filter((r) => r.status === 'new').length ?? 0;

  return (
    <>
      <div className="toolbar"><div><h1>Network</h1><p className="page-sub">Trade with other businesses on Kora. Their invoices arrive by themselves, and your orders reach them without a phone call.</p></div></div>
      <div className="tabs" role="tablist" aria-label="Network">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}{k === 'received' && waiting > 0 ? ` (${waiting})` : ''}</button>)}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      {tab === 'received' && (<>
        {received === null && !err && <p className="muted" role="status">Loading</p>}
        {received && received.length === 0 && <div className="panel empty"><Icon name="inbox" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No invoices yet.</h3><p>When a business on Kora issues an invoice to your GSTIN, it appears here. Accept it and it becomes a purchase bill with its input credit.</p></div>}
        {received && received.length > 0 && (
          <table className="t cards" aria-label="Invoices received">
            <thead><tr><th>Invoice</th><th>From</th><th>Date</th><th className="n">Total</th><th>Status</th><th /></tr></thead>
            <tbody>{received.map((r) => (
              <tr key={r.id}>
                <td className="c-num"><b>{r.number}</b>{r.seller_cancelled_at && <> <span className="chip cancelled">Cancelled by seller</span></>}</td>
                <td className="c-cust">{r.seller_name}<br /><span className="muted" style={{ fontSize: 12.5 }}>{r.seller_gstin}</span></td>
                <td className="c-date">{r.doc_date}</td><td className="n c-total">{rupees(r.grand_total_paise)}<br /><span className="muted" style={{ fontSize: 12.5 }}>incl. {rupees(r.tax_paise)} GST</span></td>
                <td className="c-status">{r.status === 'new' ? <span className="chip issued">New</span> : r.status === 'accepted' ? <span className="chip paid">Accepted</span> : <span className="chip cancelled" title={r.reason ?? ''}>Rejected</span>}</td>
                <td className="n">
                  {r.status === 'new' && canBuy && !r.seller_cancelled_at && (<>
                    <button className="sm" disabled={busy} onClick={() => run(async () => { const a = await api(`/api/network/received/${r.id}`, { method: 'PATCH', body: { action: 'accept' } }); window.location.href = `/app/purchases/${a.billId}`; })}>Accept</button>{' '}
                    <button className="secondary sm" disabled={busy} onClick={() => setRejecting({ id: r.id, reason: '' })}>Reject</button></>)}
                  {r.status === 'accepted' && r.bill_id && <a href={`/app/purchases/${r.bill_id}`}>Open the bill</a>}
                  {rejecting?.id === r.id && (
                    <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/network/received/${r.id}`, { method: 'PATCH', body: { action: 'reject', reason: rejecting.reason } }); setRejecting(null); await loadReceived(); }); }} style={{ marginTop: 8, textAlign: 'left' }}>
                      <label htmlFor={`rj${r.id}`}>Why are you rejecting it?</label>
                      <input id={`rj${r.id}`} value={rejecting.reason} maxLength={300} onChange={(e) => setRejecting({ id: r.id, reason: e.target.value })} required />
                      <button className="danger sm" disabled={busy} style={{ marginTop: 8 }}>Reject invoice</button>
                    </form>)}
                </td>
              </tr>))}</tbody>
          </table>)}
      </>)}

      {tab === 'orders' && (<>
        <div className="tabs" role="group" aria-label="Orders">
          <button type="button" aria-pressed={side === 'received'} onClick={() => setSide('received')}>Orders I received</button>
          <button type="button" aria-pressed={side === 'sent'} onClick={() => setSide('sent')}>Orders I sent</button>
        </div>
        {orders === null && !err && <p className="muted" role="status">Loading</p>}
        {orders && orders.length === 0 && <div className="panel empty"><Icon name="cart" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No orders here.</h3><p>{side === 'sent' ? 'Find a supplier in the Directory and send them an order.' : 'Orders from other businesses show up here once you list your business.'}</p></div>}
        {orders && orders.length > 0 && (
          <table className="t cards" aria-label="Orders list">
            <thead><tr><th>Order</th><th>{side === 'sent' ? 'To' : 'From'}</th><th>Date</th><th className="n">Items</th><th>Status</th><th /></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td className="c-num"><b>{o.po_number}</b></td><td className="c-cust">{side === 'sent' ? o.seller_name : o.buyer_name}</td><td className="c-date">{o.po_date}{o.expected_on ? ` · wanted by ${o.expected_on}` : ''}</td>
                <td className="n c-type">{o.line_count}</td><td className="c-status"><span className={`chip ${ORDER_CHIP[o.status]}`}>{ORDER_LABEL[o.status]}</span>{o.decline_reason && <span className="muted" style={{ fontSize: 12.5 }}> {o.decline_reason}</span>}</td>
                <td className="n">
                  {o.status === 'sent' && side === 'received' && canSell && (<>
                    <button className="sm" disabled={busy} onClick={() => run(async () => { const a = await api(`/api/network/orders/${o.id}`, { method: 'PATCH', body: { action: 'accept' } }); window.location.href = `/app/invoices/${a.documentId}`; })}>Accept</button>{' '}
                    <button className="secondary sm" disabled={busy} onClick={() => setDeclining({ id: o.id, reason: '' })}>Decline</button></>)}
                  {o.status === 'sent' && side === 'sent' && canBuy && <button className="secondary sm" disabled={busy} onClick={() => run(async () => { await api(`/api/network/orders/${o.id}`, { method: 'PATCH', body: { action: 'cancel' } }); await loadOrders(); })}>Cancel</button>}
                  {o.status === 'accepted' && side === 'received' && o.seller_document_id && <a href={`/app/invoices/${o.seller_document_id}`}>Open the invoice</a>}
                  {declining?.id === o.id && (
                    <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/network/orders/${o.id}`, { method: 'PATCH', body: { action: 'decline', reason: declining.reason } }); setDeclining(null); await loadOrders(); }); }} style={{ marginTop: 8, textAlign: 'left' }}>
                      <label htmlFor={`dc${o.id}`}>Why are you declining it?</label>
                      <input id={`dc${o.id}`} value={declining.reason} maxLength={300} onChange={(e) => setDeclining({ id: o.id, reason: e.target.value })} required />
                      <button className="danger sm" disabled={busy} style={{ marginTop: 8 }}>Decline order</button>
                    </form>)}
                </td>
              </tr>))}</tbody>
          </table>)}
      </>)}

      {tab === 'directory' && (<>
        <div className="filters"><div style={{ flex: 1 }}><label htmlFor="dq">Search suppliers</label><input id="dq" type="search" placeholder="Name, product, city or category" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {dir === null && !err && <p className="muted" role="status">Loading</p>}
        {dir && dir.length === 0 && <div className="panel empty"><Icon name="team" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No businesses found.</h3><p>Businesses appear here when they choose to be listed.</p></div>}
        {dir && dir.length > 0 && <div className="l-grid" style={{ marginTop: 6 }}>{dir.map((b) => (
          <article key={b.business_id} className="l-card" aria-label={b.name}>
            <h3>{b.name}</h3><p className="muted" style={{ fontSize: 13 }}>{b.gstin}{b.city ? ` · ${b.city}` : ''}</p>
            {b.about && <p>{b.about}</p>}
            {b.categories.length > 0 && <p>{b.categories.map((c) => <span key={c} className="chip draft" style={{ marginRight: 4 }}>{c}</span>)}</p>}
            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <button className="secondary sm" style={{ flex: 'none' }} onClick={() => run(async () => { setCat(await api(`/api/network/catalogue/${b.business_id}`)); })}>Catalogue ({b.items})</button>
              {canBuy && <button className="sm" style={{ flex: 'none' }} onClick={() => setPo({ sellerId: b.business_id, sellerName: b.name, lines: [{ name: '', hsnSac: '', unit: 'NOS', quantity: '1', rate: '', taxRateBp: 1800 }], notes: '', expectedOn: '' })}>Send an order</button>}
            </div>
          </article>))}</div>}

        {cat && (
          <div className="panel" aria-label={`Catalogue of ${cat.seller.name}`} style={{ marginTop: 16 }}>
            <div className="row" style={{ alignItems: 'center' }}><h2 style={{ margin: 0 }}>{cat.seller.name}: catalogue</h2><button className="secondary sm" style={{ flex: 'none' }} onClick={() => setCat(null)}>Close</button></div>
            {cat.items.length === 0 ? <p className="muted">This business has not listed any items yet.</p> : (
              <table className="t" aria-label="Catalogue"><thead><tr><th>Item</th><th>HSN/SAC</th><th>GST</th><th className="n">Price</th><th /></tr></thead>
                <tbody>{cat.items.map((i) => (<tr key={i.name}><td>{i.name}</td><td>{i.hsn_sac ?? ''}</td><td>{i.default_rate_bp / 100}%</td><td className="n">{rupees(i.price_paise)}{i.price_includes_tax ? ' incl.' : ''} / {i.unit}</td>
                  <td className="n">{canBuy && <button className="link" onClick={() => setPo((p) => ({ sellerId: cat.seller.id, sellerName: cat.seller.name, notes: p?.notes ?? '', expectedOn: p?.expectedOn ?? '', lines: [...(p && p.sellerId === cat.seller.id ? p.lines.filter((l) => l.name) : []), { name: i.name, hsnSac: i.hsn_sac ?? '', unit: i.unit, quantity: '1', rate: (BigInt(i.price_paise) / 100n).toString() + (BigInt(i.price_paise) % 100n === 0n ? '' : `.${(BigInt(i.price_paise) % 100n).toString().padStart(2, '0')}`), taxRateBp: i.default_rate_bp }] }))}>Add to order</button>}</td></tr>))}</tbody></table>)}
          </div>)}

        {po && (
          <form className="panel" aria-label="New order" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); void run(async () => {
            const r = await api('/api/network/orders', { body: { sellerBusinessId: po.sellerId, notes: po.notes || null, expectedOn: po.expectedOn || null, lines: po.lines.map((l) => ({ name: l.name, hsnSac: l.hsnSac || null, unit: l.unit, quantity: l.quantity, rate: l.rate, taxRateBp: l.taxRateBp })) } });
            setPo(null); setCat(null); setMsg(`Order ${r.poNumber} sent to ${po.sellerName}.`); setSide('sent'); setTab('orders');
          }); }}>
            <p className="section-label">Order to {po.sellerName}</p>
            <table className="t line-table" aria-label="Order lines">
              <thead><tr><th>Item</th><th>HSN/SAC</th><th className="n">Qty</th><th className="n">Rate</th><th>GST</th><th /></tr></thead>
              <tbody>{po.lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="Item"><input aria-label={`Order line ${i + 1} item`} value={l.name} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} required /></td>
                  <td data-label="HSN or SAC"><input aria-label={`Order line ${i + 1} HSN or SAC`} value={l.hsnSac} inputMode="numeric" onChange={(e) => setPo({ ...po, lines: po.lines.map((x, k) => (k === i ? { ...x, hsnSac: e.target.value } : x)) })} /></td>
                  <td className="n" data-label="Quantity"><input aria-label={`Order line ${i + 1} quantity`} value={l.quantity} inputMode="decimal" onChange={(e) => setPo({ ...po, lines: po.lines.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)) })} required /></td>
                  <td className="n" data-label="Rate"><input aria-label={`Order line ${i + 1} rate`} value={l.rate} inputMode="decimal" onChange={(e) => setPo({ ...po, lines: po.lines.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)) })} required /></td>
                  <td data-label="GST"><select aria-label={`Order line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, k) => (k === i ? { ...x, taxRateBp: Number(e.target.value) } : x)) })}>{TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                  <td className="line-remove">{po.lines.length > 1 && <button type="button" className="link" onClick={() => setPo({ ...po, lines: po.lines.filter((_, k) => k !== i) })}>Remove</button>}</td>
                </tr>))}</tbody>
            </table>
            <button type="button" className="secondary sm" style={{ marginTop: 10 }} onClick={() => setPo({ ...po, lines: [...po.lines, { name: '', hsnSac: '', unit: 'NOS', quantity: '1', rate: '', taxRateBp: 1800 }] })}><Icon name="plus" size={16} />Add line</button>
            <div className="row"><div><label htmlFor="po-d">Wanted by</label><input id="po-d" type="date" value={po.expectedOn} onChange={(e) => setPo({ ...po, expectedOn: e.target.value })} /></div><div style={{ flex: 2 }}><label htmlFor="po-n">Note to the supplier</label><input id="po-n" value={po.notes} maxLength={1000} onChange={(e) => setPo({ ...po, notes: e.target.value })} /></div></div>
            <button disabled={busy} style={{ marginTop: 12 }}>Send order</button>{' '}
            <button type="button" className="secondary" onClick={() => setPo(null)}>Cancel</button>
          </form>)}
      </>)}

      {tab === 'listing' && st && (
        <>
          <div className="panel" aria-label="Receiving invoices">
            <h2>Receive invoices through Kora</h2>
            <p className="muted">When another Kora business issues an invoice to your GSTIN, it arrives here for you to accept or reject. It saves retyping and keeps your input credit right.</p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={st.receive} disabled={busy || role !== 'owner'} onChange={(e) => run(async () => { await api('/api/network/settings', { method: 'PUT', body: { receive: e.target.checked } }); await loadSettings(); })} /> Receive invoices sent through Kora</label>
          </div>
          <form className="panel" aria-label="Your listing" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/network/settings', { method: 'PUT', body: { about: form.about || null, city: form.city || null, categories: form.categories.split(',').map((c) => c.trim()).filter(Boolean) } }); setMsg('Saved.'); await loadSettings(); }); }}>
            <h2>List your business</h2>
            <p className="muted">Listed businesses can be found by others and sent orders. Only your business name, GSTIN, city, description and the catalogue items you choose are shown. Nothing about your sales or customers is.</p>
            {!st.hasGstin && <p className="warn" role="status">Add your GSTIN in Settings to be listed.</p>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={st.listed} disabled={busy || role !== 'owner' || !st.hasGstin} onChange={(e) => run(async () => { await api('/api/network/settings', { method: 'PUT', body: { listed: e.target.checked } }); await loadSettings(); })} /> Show my business in the directory</label>
            <div className="row">
              <div style={{ flex: 2 }}><label htmlFor="la">What do you sell?</label><input id="la" value={form.about} maxLength={600} onChange={(e) => setForm({ ...form, about: e.target.value })} disabled={role !== 'owner'} /></div>
              <div><label htmlFor="lc">City</label><input id="lc" value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} disabled={role !== 'owner'} /></div>
            </div>
            <label htmlFor="lk">Categories, separated by commas</label><input id="lk" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="Steel, Construction" disabled={role !== 'owner'} />
            <p className="muted" style={{ fontSize: 13 }}>{st.listedItems} {st.listedItems === 1 ? 'item is' : 'items are'} in your catalogue. Choose them on the Items page.</p>
            {role === 'owner' && <button disabled={busy}>Save listing</button>}
          </form>
        </>)}
    </>
  );
}
