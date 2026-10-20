'use client';
import Icon from './Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES, formatMoney, gstinValid, STATE_NAMES } from '@kora/tax';
import { api, ApiError, DOC_LABEL, rupees as rupeesInr, TAX_RATES } from '../lib/client';
import { cacheGet, cacheSet, getDraft, isNetworkError, newId, putDraft, removeDraft, type LocalDraft } from '../lib/offline';
import { localTotals, type BusinessFacts, type PartyFacts } from '../lib/localTotals';
import { syncDrafts } from '../lib/sync';

type Line = { key: number; itemId: string | null; name: string; hsnSac: string; quantity: string; rate: string; discount: string; taxRateBp: number; kind: 'goods' | 'service'; taxInclusive: boolean };
type Party = PartyFacts & { phone: string | null; currency?: string };
type Item = { id: string; name: string; kind: 'goods' | 'service'; hsn_sac: string | null; default_rate_bp: number; price_paise: string; price_includes_tax?: boolean };
type Totals = { supply: 'intra' | 'inter'; placeOfSupply: string; warnings: string[]; taxable: string; cgst: string; sgst: string; igst: string; cess: string;
  tcs: string; tds: string; netReceivable: string; roundOff: string; grandTotal: string; recommendedDocType: string; lines: { total: string }[] };

/** "0.1" -> 10 basis points. Two decimals at most, 0 to 100. Returns null when the text is not a percentage. */
const pctToBp = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(parseFloat(t) * 100);
  return n >= 0 && n <= 10000 ? n : null;
};
const bpToPct = (bp: number | null | undefined) => (bp ? String(bp / 100) : '');

/** 83250000 -> "83.25". The rate is stored in millionths of a rupee per unit. */
const microToText = (m: string | number) => { const n = BigInt(m); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`; };

let seq = 1;
const blankLine = (): Line => ({ key: seq++, itemId: null, name: '', hsnSac: '', quantity: '1', rate: '', discount: '', taxRateBp: 1800, kind: 'goods', taxInclusive: false });
const rs = (p: string) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };

/** Reference data comes from the server when it can, and from this device when it cannot. */
async function fromServerOrDevice<T>(key: string, url: string, pick: (r: any) => T, fallback: T): Promise<T> {
  try { const v = pick(await api(url)); await cacheSet(key, v); return v; }
  catch (e) { if (e instanceof ApiError) throw e; return (await cacheGet<T>(key)) ?? fallback; }
}

export default function DocumentEditor({ draftId, localId: localIdProp, initial }: { draftId?: string; localId?: string; initial?: { docType?: string } }) {
  const [docType, setDocType] = useState(initial?.docType ?? 'tax_invoice');
  const [partyId, setPartyId] = useState('');
  const [docDate, setDocDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [reverseCharge, setRcm] = useState(false);
  const [currency, setCurrency] = useState('INR');
  const [rate, setRate] = useState('');
  const [tcsPct, setTcsPct] = useState('');
  const [tdsPct, setTdsPct] = useState('');
  const quote = docType === 'estimate' || docType === 'proforma';
  const rupees = (p: string | bigint | null | undefined) => (currency === 'INR' ? rupeesInr(p) : formatMoney(BigInt(p ?? 0), currency));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [original, setOriginal] = useState<string | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [business, setBusiness] = useState<BusinessFacts | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [hint, setHint] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCust, setNewCust] = useState(false);
  const [nc, setNc] = useState({ name: '', gstin: '', stateCode: '', phone: '', line1: '', city: '', pincode: '' });
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [localId, setLocalId] = useState<string | null>(localIdProp ?? null);
  const [clientRef, setClientRef] = useState('');
  const [serverId, setServerId] = useState<string | null>(draftId ?? null);
  const [baseRev, setBaseRev] = useState<number | null>(null);
  const [local, setLocal] = useState<LocalDraft | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [otherTotal, setOtherTotal] = useState<string | null>(null);
  const inFlight = useRef(false); // set synchronously, so a double click cannot start two saves

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const fill = (p: Record<string, any>) => {
    setDocType(p.docType); setPartyId(p.partyId ?? ''); setDocDate(p.docDate ?? ''); setDueDate(p.dueDate ?? ''); setNotes(p.notes ?? ''); setTerms(p.terms ?? '');
    setRcm(!!p.reverseCharge); setOriginal(p.originalDocumentId ?? null); setTcsPct(bpToPct(p.tcsBp)); setTdsPct(bpToPct(p.tdsBp)); setCurrency(p.currency ?? 'INR'); setRate(p.exchangeRate ?? '');
    setLines((p.lines as any[]).map((l) => ({ key: seq++, itemId: l.itemId ?? null, name: l.name, hsnSac: l.hsnSac ?? '', quantity: String(l.quantity), rate: String(l.rate),
      discount: l.discount ?? '', taxRateBp: l.taxRateBp, kind: l.kind ?? 'goods', taxInclusive: !!l.taxInclusive })));
  };

  useEffect(() => {
    (async () => {
      try {
        setParties(await fromServerOrDevice<Party[]>('parties', '/api/parties', (r) => r.parties, []));
        setItems(await fromServerOrDevice<Item[]>('items', '/api/items', (r) => r.items, []));
        setBusiness(await fromServerOrDevice<BusinessFacts | null>('business', '/api/business', (r) => r.business, null));
        if (localIdProp) {
          const d = await getDraft(localIdProp);
          if (!d) { setErr('This draft is no longer on this device. It may have already synced.'); return; }
          setLocal(d); setClientRef(d.clientRef); setServerId(d.conflict?.serverId ?? d.serverId); setBaseRev(d.baseRev); fill(d.payload);
        } else if (draftId) {
          try {
            const { document: d, lines: ls } = await api(`/api/documents/${draftId}`);
            setClientRef(d.client_ref ?? newId()); setBaseRev(Number(d.rev));
            setDocType(d.doc_type); setPartyId(d.party_id ?? ''); setDocDate(d.doc_date); setDueDate(d.due_date ?? ''); setNotes(d.notes ?? ''); setTerms(d.terms ?? '');
            setRcm(d.reverse_charge); setOriginal(d.original_document_id); setTcsPct(bpToPct(d.tcs_bp)); setTdsPct(bpToPct(d.tds_bp)); setCurrency(d.currency ?? 'INR'); setRate(d.currency && d.currency !== 'INR' ? microToText(d.exchange_rate_micro) : '');
            setLines(ls.map((l: any) => ({ key: seq++, itemId: l.item_id, name: l.item_name, hsnSac: l.hsn_sac ?? '', quantity: String(l.quantity).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '1',
              rate: rs(l.rate_paise), discount: BigInt(l.discount_paise) > 0n ? rs(l.discount_paise) : '', taxRateBp: l.tax_rate_bp, kind: 'goods', taxInclusive: !!l.price_includes_tax })));
          } catch (e) {
            setErr(isNetworkError(e) ? 'This draft is on the server and cannot be opened while you are offline.' : (e as Error).message); return;
          }
        } else setClientRef(newId());
        setReady(true);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [draftId, localIdProp]);

  const payload = useMemo(() => ({
    docType, partyId: partyId || null, docDate: docDate || undefined, dueDate: dueDate || null, notes, terms, reverseCharge,
    originalDocumentId: original, tcsBp: pctToBp(tcsPct) ?? 0, tdsBp: pctToBp(tdsPct) ?? 0,
    ...(currency !== 'INR' && quote ? { currency, exchangeRate: rate } : {}),
    lines: lines.filter((l) => l.name.trim() || l.rate).map((l) => ({ itemId: l.itemId, name: l.name, hsnSac: l.hsnSac || null, quantity: l.quantity || '0',
      rate: l.rate || '0', discount: l.discount || undefined, taxRateBp: l.taxRateBp, kind: l.kind, taxInclusive: l.taxInclusive || undefined })),
  }), [docType, partyId, docDate, dueDate, notes, terms, reverseCharge, lines, original, tcsPct, tdsPct, currency, rate, quote]);

  // Live totals. The server is the authority; offline, the same tax library runs on this device.
  useEffect(() => {
    if (!ready || payload.lines.length === 0) { setTotals(null); setHint(''); return; }
    const h = setTimeout(async () => {
      try {
        const t = await api('/api/documents/preview', { body: payload });
        setTotals(t); setHint('');
      } catch (e) {
        if (isNetworkError(e) && business) {
          try {
            const t = localTotals({ business, party: parties.find((p) => p.id === partyId) ?? null, payload });
            setTotals(t as Totals | null); setHint(t ? '' : 'Add a line to see the total.');
          } catch (x) { setTotals(null); setHint((x as Error).message); }
        } else { setTotals(null); setHint((e as Error).message); }
      }
    }, 250);
    return () => clearTimeout(h);
  }, [payload, ready, business, parties, partyId]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickName = (key: number, name: string) => {
    const it = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    setLine(key, it ? { name, itemId: it.id, hsnSac: it.hsn_sac ?? '', rate: rs(it.price_paise), taxRateBp: it.default_rate_bp, kind: it.kind, taxInclusive: !!it.price_includes_tax } : { name, itemId: null });
  };

  const addCustomer = async () => {
    setErr('');
    try {
      const gstin = nc.gstin.trim().toUpperCase();
      const r = await api('/api/parties', { body: { kind: 'customer', name: nc.name, gstin: gstin || null, stateCode: nc.stateCode || null, phone: nc.phone || null, billingAddress: { line1: nc.line1, city: nc.city, pincode: nc.pincode } } });
      const list = (await api('/api/parties')).parties as Party[];
      setParties(list); void cacheSet('parties', list); setPartyId(r.id); setNewCust(false); setNc({ name: '', gstin: '', stateCode: '', phone: '', line1: '', city: '', pincode: '' });
    } catch (e) { setErr((e as Error).message); }
  };

  const summary = () => ({ customer: parties.find((p) => p.id === partyId)?.name ?? 'Walk-in customer', total: totals ? rupees(totals.grandTotal) : null });

  /** Keeps the draft on this device. It syncs by itself when the connection is back. */
  const saveLocal = async (status: LocalDraft['status'] = 'pending', extra: Partial<LocalDraft> = {}) => {
    const id = localId ?? newId();
    const ok = await putDraft({ localId: id, clientRef, serverId, baseRev, payload, summary: summary(), status, updatedAt: Date.now(), ...extra });
    if (!ok) { setErr('This device cannot keep drafts offline (private browsing or blocked storage). Reconnect to save.'); return false; }
    setLocalId(id); setSavedLocally(true);
    return true;
  };

  const save = async (issue: boolean) => {
    if (inFlight.current) return;
    if (pctToBp(tcsPct) === null || pctToBp(tdsPct) === null) { setErr('Enter TCS and TDS as a percentage between 0 and 100, with at most two decimals.'); return; }
    if (issue && !online) { setErr('Issuing needs a connection. Save the draft now and issue it when you are back online.'); return; }
    inFlight.current = true;
    setErr(''); setBusy(true); setSavedLocally(false);
    const release = () => { setBusy(false); inFlight.current = false; };
    try {
      const body = { ...payload, clientRef, ...(baseRev !== null ? { baseRev } : {}) };
      let r: any;
      try {
        r = await api(serverId ? `/api/documents/${serverId}` : '/api/documents', { method: serverId ? 'PUT' : 'POST', body });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await saveLocal('conflict', { conflict: { serverId: serverId ?? '', serverRev: 0 } });
          setErr('This draft was changed on another device. Open it from the list to choose which version to keep.');
          release(); return;
        }
        if (!(e instanceof ApiError) && isNetworkError(e)) {
          if (issue) throw new Error('The connection dropped before this could be issued. Your draft is saved on this device.');
          await saveLocal();
          release(); return;
        }
        throw e;
      }
      if (localId) await removeDraft(localId);
      if (issue) await api(`/api/documents/${r.id}/issue`, { body: {} });
      window.location.href = `/app/invoices/${r.id}${issue ? '?sent=0' : ''}`;
    } catch (e) {
      if (isNetworkError(e) && !issue) await saveLocal(); else setErr((e as Error).message);
      release();
    }
  };

  const keepMine = async () => {
    if (!local?.conflict) return;
    setBusy(true);
    const cur = (await api(`/api/documents/${local.conflict.serverId}`)).document;
    await putDraft({ ...local, payload, serverId: local.conflict.serverId, baseRev: Number(cur.rev), status: 'pending', conflict: undefined, error: undefined });
    const r = await syncDrafts();
    if (r.synced) window.location.href = `/app/invoices/${local.conflict.serverId}`;
    else { setBusy(false); setErr('Could not sync yet. It will keep trying.'); }
  };
  const useOther = async () => {
    if (!local?.conflict) return;
    await removeDraft(local.localId);
    window.location.href = `/app/invoices/${local.conflict.serverId}/edit`;
  };
  useEffect(() => {
    if (!local?.conflict) return;
    api(`/api/documents/${local.conflict.serverId}`).then((d) => setOtherTotal(rupees(d.document.grand_total_paise))).catch(() => {});
  }, [local]);

  if (!ready) return <p className="muted">{err || 'Loading the draft'}</p>;

  const label = DOC_LABEL[docType] ?? 'document';
  const ncState = nc.gstin.trim().length >= 2 && STATE_NAMES[nc.gstin.trim().slice(0, 2)] ? nc.gstin.trim().slice(0, 2) : nc.stateCode;
  const title = localId || draftId ? 'Edit draft' : `New ${label.toLowerCase()}`;

  return (
    <>
      <div className="toolbar"><div><h1>{title}</h1><p className="page-sub">{quote ? 'Quote a price. Nothing here is a tax invoice until you turn it into one.' : 'Choose who it is for and what you are selling. Kora works out the tax as you type.'}</p></div></div>
      {local?.conflict && (
        <div className="panel" role="alert" data-testid="conflict">
          <h2>This draft was changed on another device</h2>
          <p>Your version is {summary().total ?? 'not yet totalled'}{otherTotal ? `; the other version is ${otherTotal}` : ''}. Choose which one to keep. The other is discarded.</p>
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <button style={{ flex: 'none' }} disabled={busy} onClick={keepMine}>Keep my version</button>
            <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={useOther}>Use the other version</button>
          </div>
        </div>
      )}
      {local?.status === 'error' && <p className="error" role="alert">This draft could not be saved: {local.error} Fix it and save again.</p>}
      {!online && <p className="warn" role="status" data-testid="offline-note">You are offline. Totals are worked out on this device and checked again when the draft syncs.</p>}
      <div className="editor">
      <div className="editor-main">
      <section className="panel" aria-label="Customer and dates">
        <p className="section-label">Customer and dates</p>
        <div className="grid2">
          <div>
            <label htmlFor="cu" style={{ marginTop: 0 }}>Customer</label>
            <select id="cu" value={newCust ? '__new' : partyId} onChange={(e) => { if (e.target.value === '__new') setNewCust(true); else { setNewCust(false); setPartyId(e.target.value); const pc = parties.find((x) => x.id === e.target.value)?.currency; if (quote && pc && pc !== 'INR' && currency === 'INR') setCurrency(pc); } }} disabled={!!original}>
              <option value="">Walk-in customer</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.gstin ? ` (${p.gstin})` : ''}</option>)}
              {online && <option value="__new">+ New customer</option>}
            </select>
            {!online && <p className="muted">New customers can be added when you are back online.</p>}
            {quote && (
              <div className="row" style={{ marginTop: 8 }}>
                <div><label htmlFor="cur">Currency</label>
                  <select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c === 'INR' ? 'INR (rupees)' : c}</option>)}</select></div>
                {currency !== 'INR' && (
                  <div><label htmlFor="fx">Exchange rate (Rs for 1 {currency})</label><input id="fx" inputMode="decimal" placeholder="83.25" value={rate} onChange={(e) => setRate(e.target.value)} /></div>)}
              </div>)}
            {quote && currency !== 'INR' && <p className="muted">This is a quote, not a tax invoice. When the customer accepts, it turns into an invoice in rupees at this rate.</p>}
          </div>
          <div>
            <label htmlFor="dt" style={{ marginTop: 0 }}>Document type</label>
            <select id="dt" value={docType} onChange={(e) => { setDocType(e.target.value); if (!['estimate', 'proforma'].includes(e.target.value)) setCurrency('INR'); }} disabled={!!original}>
              {Object.entries(DOC_LABEL).filter(([k]) => original ? k === docType : !['credit_note', 'debit_note'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label htmlFor="dd">Date</label><input id="dd" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div><label htmlFor="du">{docType === 'estimate' ? 'Valid until' : 'Due date'}</label><input id="du" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        {newCust && online && (
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 12 }}>
            <legend>New customer</legend>
            <div className="row">
              <div><label htmlFor="ncn">Customer name</label><input id="ncn" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></div>
              <div><label htmlFor="ncg">GSTIN (optional)</label><input id="ncg" value={nc.gstin} maxLength={15} onChange={(e) => setNc({ ...nc, gstin: e.target.value })} />
                {nc.gstin.trim().length === 15 && !gstinValid(nc.gstin.trim().toUpperCase()) && <div className="error">Not a valid GSTIN.</div>}</div>
              <div><label htmlFor="ncs">State</label>
                <select id="ncs" value={ncState} onChange={(e) => setNc({ ...nc, stateCode: e.target.value })} disabled={ncState !== nc.stateCode}>
                  <option value="">Choose a state</option>
                  {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select></div>
              <div><label htmlFor="ncp">Mobile (optional)</label><input id="ncp" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></div>
            </div>
            {nc.gstin.trim().length === 15 && (
              <div className="row">
                <div><label htmlFor="nca">Address line 1 (needed for e-invoice)</label><input id="nca" value={nc.line1} onChange={(e) => setNc({ ...nc, line1: e.target.value })} /></div>
                <div><label htmlFor="ncc">City</label><input id="ncc" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} /></div>
                <div><label htmlFor="ncz">Pincode</label><input id="ncz" inputMode="numeric" maxLength={6} value={nc.pincode} onChange={(e) => setNc({ ...nc, pincode: e.target.value })} /></div>
              </div>
            )}
            <button type="button" className="sm" style={{ margin: '8px 0' }} onClick={addCustomer}>Add customer</button>
          </fieldset>
        )}
      </section>

      <section className="panel" aria-label="Items">
      <p className="section-label">Items</p>
      <table className="t line-table" aria-label="Line items">
        <thead><tr><th>Item details</th><th className="n">Qty</th><th className="n">Rate{currency !== 'INR' ? ` (${currency})` : ''}</th><th className="n">Discount</th><th>GST</th><th className="n">Amount</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const idx = lines.filter((x) => x.name.trim() || x.rate).findIndex((x) => x.key === l.key);
            return (
              <tr key={l.key}>
                <td className="item-cell" data-label="Description"><input aria-label={`Line ${i + 1} description`} placeholder="Item or service" list="items-list" value={l.name} onChange={(e) => pickName(l.key, e.target.value)} />
                  <div className="item-sub"><div className="sub-field"><span aria-hidden="true">HSN/SAC</span><input aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" value={l.hsnSac} onChange={(e) => setLine(l.key, { hsnSac: e.target.value })} /></div>
                    <label className="incl"><input type="checkbox" aria-label={`Line ${i + 1} price includes GST`} checked={l.taxInclusive} onChange={(e) => setLine(l.key, { taxInclusive: e.target.checked })} /> price has GST in it</label></div></td>
                <td className="n" data-label="Quantity"><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></td>
                <td className="n" data-label="Rate"><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} /></td>
                <td className="n" data-label="Discount"><input aria-label={`Line ${i + 1} discount`} inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} /></td>
                <td data-label="GST"><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(l.key, { taxRateBp: Number(e.target.value) })}>
                  {TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td className="n line-amount" data-label="Amount">{idx >= 0 && totals?.lines[idx]?.total ? rupees(totals.lines[idx]!.total) : ''}</td>
                <td className="line-remove">{lines.length > 1 && <button type="button" className="link" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id="items-list">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
      <button type="button" className="secondary sm" style={{ marginTop: 10 }} onClick={() => setLines((ls) => [...ls, blankLine()])}><Icon name="plus" size={16} />Add line</button>
      </section>

      <section className="panel" aria-label="Notes and extras">
      <p className="section-label">Notes and extras</p>
      <div>
        <div>
          <label htmlFor="nt" style={{ marginTop: 0 }}>Notes</label><textarea id="nt" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label htmlFor="tm">Terms</label><textarea id="tm" value={terms} onChange={(e) => setTerms(e.target.value)} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={reverseCharge} onChange={(e) => setRcm(e.target.checked)} /> Tax is payable by the recipient (reverse charge)</label>
          {['tax_invoice', 'bill_of_supply', 'debit_note'].includes(docType) && (
            <div className="row" style={{ marginTop: 8 }}>
              <div><label htmlFor="tcs">TCS rate (%)</label><input id="tcs" inputMode="decimal" placeholder="0" value={tcsPct} onChange={(e) => setTcsPct(e.target.value)} aria-invalid={pctToBp(tcsPct) === null} /></div>
              <div><label htmlFor="tds">TDS rate (%)</label><input id="tds" inputMode="decimal" placeholder="0" value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} aria-invalid={pctToBp(tdsPct) === null} /></div>
            </div>)}
          {(pctToBp(tcsPct) === null || pctToBp(tdsPct) === null) && <p className="error" role="alert">Enter TCS and TDS as a percentage between 0 and 100, with at most two decimals.</p>}
        </div>
      </div>
      </section>
      </div>

      <aside className="editor-side" aria-label="Summary">
        <div className="sumcard">
          <p className="section-label">Summary</p>
          <div className="billto">
            <span className="k">Bill to</span>
            <b>{parties.find((p) => p.id === partyId)?.name ?? 'Walk-in customer'}</b>
            {parties.find((p) => p.id === partyId)?.gstin && <span className="muted">GSTIN {parties.find((p) => p.id === partyId)?.gstin}</span>}
            {totals && <span className="muted">Place of supply: {STATE_NAMES[totals.placeOfSupply]}</span>}
          </div>
          <div className="totals" aria-live="polite" aria-label="Totals">
            {totals ? (<>
              <div><span>Taxable value</span><span>{rupees(totals.taxable)}</span></div>
              {totals.supply === 'intra' ? (<><div><span>CGST</span><span>{rupees(totals.cgst)}</span></div><div><span>SGST</span><span>{rupees(totals.sgst)}</span></div></>) : <div><span>IGST</span><span>{rupees(totals.igst)}</span></div>}
              {BigInt(totals.cess) > 0n && <div><span>Cess</span><span>{rupees(totals.cess)}</span></div>}
              {BigInt(totals.tcs) > 0n && <div><span>TCS</span><span data-testid="tcs-amount">{rupees(totals.tcs)}</span></div>}
              {BigInt(totals.roundOff) !== 0n && <div><span>Round off</span><span>{BigInt(totals.roundOff) < 0n ? '-' : ''}{rupees(BigInt(totals.roundOff) < 0n ? -BigInt(totals.roundOff) : totals.roundOff)}</span></div>}
              <div className="grand"><span>Total</span><span data-testid="grand-total">{rupees(totals.grandTotal)}</span></div>
              {BigInt(totals.tds) > 0n && <div className="muted" data-testid="tds-note">Customer deducts {rupees(totals.tds)} as TDS, so they pay <b>{rupees(totals.netReceivable)}</b>. Record the TDS as a payment when it arrives.</div>}
              <div className="muted">Place of supply: {STATE_NAMES[totals.placeOfSupply]} ({totals.supply === 'intra' ? 'within state' : 'other state'})</div>
              {totals.recommendedDocType === 'bill_of_supply' && docType === 'tax_invoice' && <div className="warn">Every line is at 0%. A bill of supply may be the right document.</div>}
              {totals.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
            </>) : <div className="muted">{hint || 'Add a line to see the total.'}</div>}
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          {savedLocally && <p className="ok" role="status" data-testid="saved-locally">Saved on this device. It will sync when you are back online.</p>}
          <div className="actions">
            <button type="button" disabled={busy || !online || !!local?.conflict} title={online ? undefined : 'Issuing needs a connection'} onClick={() => save(true)}>Issue {label.toLowerCase()}</button>
            <button type="button" className="secondary" disabled={busy || !!local?.conflict} onClick={() => save(false)}>Save draft</button>
          </div>
        </div>
      </aside>
      </div>
    </>
  );
}
