'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatRupees } from '@kora/tax';
import Icon from '../../../components/Icon';
import { api, rupees } from '../../../lib/client';
import { localTotals, type BusinessFacts } from '../../../lib/localTotals';

type Item = { id: string; name: string; kind: 'goods' | 'service'; hsn_sac: string | null; unit: string; default_rate_bp: number; price_paise: string; price_includes_tax: boolean; track_stock: boolean; barcode: string | null; qty_milli: string | null };
type Cart = { item: Item; quantity: string; rate: string; discount: string };
const rs = (p: string | bigint) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };
const METHODS: [string, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']];
const stockOf = (i: Item) => (i.track_stock && i.qty_milli !== null ? Number(BigInt(i.qty_milli)) / 1000 : null);

/** A till: scan or search, build the bill, take the money, print the receipt. */
export default function Pos() {
  const [business, setBusiness] = useState<(BusinessFacts & { registration_type: string }) | null>(null);
  const [role, setRole] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<Cart[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Item[]>([]);
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; number: string; totalPaise: string; paid: boolean; paymentError: string | null } | null>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api('/api/business').then((b) => { setRole(b.role); setBusiness({ state_code: b.business.state_code, registration_type: b.business.registration_type, turnover_band: b.business.turnover_band } as never); }).catch((e) => setErr(e.message));
    api('/api/items').then((r) => setItems(r.items)).catch(() => {});
    box.current?.focus();
  }, []);

  const add = useCallback((item: Item) => {
    setDone(null); setErr('');
    setCart((c) => {
      const at = c.findIndex((x) => x.item.id === item.id && !x.discount);
      if (at >= 0) return c.map((x, k) => (k === at ? { ...x, quantity: String(Number(x.quantity) + 1) } : x));
      return [...c, { item, quantity: '1', rate: rs(item.price_paise), discount: '' }];
    });
    setFound([]); box.current?.focus();
  }, []);

  const submitBox = async () => {
    const term = q.trim();
    if (!term) return;
    setQ('');                                   // ready at once for the next scan
    setErr('');
    try {
      add(await api(`/api/items/barcode?code=${encodeURIComponent(term)}`));
    } catch {
      const r = await api(`/api/items?q=${encodeURIComponent(term)}`).catch(() => ({ items: [] }));
      if (r.items.length === 1) add(r.items[0]); else { setFound(r.items); if (r.items.length === 0) setErr(`Nothing found for "${term}".`); }
    }
  };

  const taxed = business ? ['regular', 'sez', 'isd'].includes(business.registration_type) : true;
  const payload = useMemo(() => ({
    docType: taxed ? 'tax_invoice' : 'bill_of_supply',
    lines: cart.map((c) => ({ name: c.item.name, quantity: c.quantity || '0', rate: c.rate || '0', discount: c.discount || undefined, taxRateBp: taxed ? c.item.default_rate_bp : 0, kind: c.item.kind, taxInclusive: taxed && c.item.price_includes_tax })),
  }), [cart, taxed]);
  const totals = useMemo(() => {
    if (!business || cart.length === 0) return null;
    try { return localTotals({ business, party: null, payload }); } catch { return null; }
  }, [business, cart, payload]);
  const total = totals ? BigInt(totals.grandTotal) : 0n;
  const change = tendered && method === 'cash' && total > 0n ? (() => { try { const t = BigInt(Math.round(Number(tendered) * 100)); return t >= total ? t - total : null; } catch { return null; } })() : null;
  const canSell = role === 'owner' || role === 'staff';

  const sell = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/pos/sale', { body: { method, lines: cart.map((c) => ({ itemId: c.item.id, name: c.item.name, hsnSac: c.item.hsn_sac, unit: c.item.unit, quantity: c.quantity, rate: c.rate, discount: c.discount || undefined, taxRateBp: c.item.default_rate_bp, kind: c.item.kind, taxInclusive: c.item.price_includes_tax })) } });
      setDone(r); setCart([]); setTendered('');
      api('/api/items').then((x) => setItems(x.items)).catch(() => {});
      box.current?.focus();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSell && cart.length && !busy) { e.preventDefault(); void sell(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <>
      <div className="toolbar"><div><h1>Till</h1><p className="page-sub">Scan or type to add items, take the money, print the receipt.</p></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {done && (
        <div className="panel" role="status" aria-label="Sale complete" style={{ borderColor: 'var(--success)' }}>
          <h2><Icon name="check" size={20} /> Sold. {done.number}, {rupees(done.totalPaise)}</h2>
          {!done.paid && <p className="error">The bill was made, but the payment was not recorded: {done.paymentError}. Open it to record the payment.</p>}
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <a className="btn" href={`/api/documents/${done.id}/pdf?layout=thermal`} target="_blank" rel="noreferrer" style={{ flex: 'none' }}>Print receipt</a>
            <a className="btn secondary" href={`/app/invoices/${done.id}`} style={{ flex: 'none' }}>Open the bill</a>
          </div>
        </div>)}

      <div className="pos">
        <div>
          <form onSubmit={(e) => { e.preventDefault(); void submitBox(); }} role="search">
            <label htmlFor="posq" style={{ marginTop: 0 }}>Scan a barcode, or type an item name</label>
            <input id="posq" ref={box} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" inputMode="search" placeholder="Barcode or name, then Enter" />
          </form>
          {found.length > 0 && <ul className="plain pos-found" aria-label="Matches">{found.map((i) => (<li key={i.id}><button type="button" className="link" onClick={() => add(i)}>{i.name}</button><span>{rupees(i.price_paise)}</span></li>))}</ul>}
          <p className="section-label" style={{ marginTop: 18 }}>Quick items</p>
          <div className="pos-tiles">
            {items.slice(0, 24).map((i) => {
              const s = stockOf(i);
              return (
                <button type="button" key={i.id} className="secondary tile" onClick={() => add(i)} aria-label={`Add ${i.name}`}>
                  <b>{i.name}</b><span>{rupees(i.price_paise)}</span>{s !== null && <small className={s <= 0 ? 'out' : ''}>{s <= 0 ? 'Out of stock' : `${s} ${i.unit} left`}</small>}
                </button>);
            })}
            {items.length === 0 && <p className="muted">Add items on the Items page and they appear here.</p>}
          </div>
        </div>

        <aside className="pos-cart" aria-label="Bill">
          <p className="section-label">Bill</p>
          {cart.length === 0 ? <p className="muted">Nothing added yet.</p> : (
            <table className="t" aria-label="Items on the bill">
              <tbody>{cart.map((c, k) => {
                const s = stockOf(c.item);
                const over = s !== null && Number(c.quantity) > s;
                return (
                  <tr key={`${c.item.id}-${k}`}>
                    <td><b>{c.item.name}</b>{over && <><br /><span className="error" style={{ fontSize: 12.5 }}>Only {s} in stock</span></>}
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <input aria-label={`${c.item.name} quantity`} inputMode="decimal" style={{ width: 64 }} value={c.quantity} onChange={(e) => setCart((x) => x.map((y, j) => (j === k ? { ...y, quantity: e.target.value } : y)))} />
                        <input aria-label={`${c.item.name} price`} inputMode="decimal" style={{ width: 84 }} value={c.rate} onChange={(e) => setCart((x) => x.map((y, j) => (j === k ? { ...y, rate: e.target.value } : y)))} />
                      </div></td>
                    <td className="n">{totals?.lines[k] ? rupees(totals.lines[k]!.total) : ''}<br /><button type="button" className="link" aria-label={`Remove ${c.item.name}`} onClick={() => setCart((x) => x.filter((_, j) => j !== k))}>Remove</button></td>
                  </tr>);
              })}</tbody>
            </table>)}
          <div className="totals" aria-label="Totals" style={{ marginTop: 10 }}>
            {totals && BigInt(totals.roundOff) !== 0n && <div className="trow"><span>Round off</span><span>{formatRupees(BigInt(totals.roundOff))}</span></div>}
            <div className="trow grand"><span>Total</span><span data-testid="pos-total">{totals ? rupees(totals.grandTotal) : 'Rs 0.00'}</span></div>
          </div>
          <div className="tabs" role="group" aria-label="Payment method" style={{ marginTop: 10 }}>
            {METHODS.map(([k, l]) => <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)}>{l}</button>)}
          </div>
          {method === 'cash' && (<>
            <label htmlFor="tender">Cash received (optional)</label>
            <input id="tender" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} />
            {change !== null && <p data-testid="change" style={{ margin: '6px 0 0' }}>Give back <b>{rupees(change)}</b></p>}
          </>)}
          {!taxed && <p className="muted" style={{ fontSize: 13 }}>Your business issues a bill of supply, so no GST is added.</p>}
          <button disabled={busy || cart.length === 0 || !canSell} onClick={() => void sell()} style={{ width: '100%', marginTop: 12, height: 50, fontSize: 16 }}>{busy ? 'Saving' : `Take ${totals ? rupees(totals.grandTotal) : 'payment'}`}</button>
          <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: '6px 0 0' }}>Ctrl and Enter takes the payment.</p>
        </aside>
      </div>
    </>
  );
}
