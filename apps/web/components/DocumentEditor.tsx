'use client';
import Icon from './Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES, dueDateFor, formatMoney, gstinValid, PAYMENT_TERMS, STATE_NAMES } from '@kora/tax';
import { api, ApiError, DOC_LABEL, rupees as rupeesInr, TAX_RATES } from '../lib/client';
import { cacheGet, cacheSet, getDraft, isNetworkError, newId, putDraft, removeDraft, type LocalDraft } from '../lib/offline';
import { localTotals, type BusinessFacts, type PartyFacts } from '../lib/localTotals';
import { effectiveDiscounts, shippingRateBp } from '../lib/discounts';
import { syncDrafts } from '../lib/sync';
import CustomFieldInputs, { type CustomDef } from './CustomFieldInputs';
import { HSN_LIST } from '../lib/hsn';

type Line = { key: number; itemId: string | null; name: string; hsnSac: string; quantity: string; rate: string; discount: string; taxRateBp: number; kind: 'goods' | 'service'; taxInclusive: boolean };
type Party = PartyFacts & { phone: string | null; currency?: string };
type Item = { id: string; name: string; kind: 'goods' | 'service'; hsn_sac: string | null; default_rate_bp: number; price_paise: string; price_includes_tax?: boolean };
type Totals = { supply: 'intra' | 'inter'; placeOfSupply: string; warnings: string[]; taxable: string; cgst: string; sgst: string; igst: string; cess: string;
  tcs: string; tds: string; netReceivable: string; adjustment?: string; roundOff: string; grandTotal: string; recommendedDocType: string; lines: { total: string }[] };

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
  // A rupee document can also show its total in another currency, for a customer abroad. The tax stays in rupees.
  // A small plus or minus on the total that is not taxed, and whether the total is rounded to the rupee.
  const [adjustment, setAdjustment] = useState('');
  const [adjLabel, setAdjLabel] = useState('');
  const [roundTotal, setRoundTotal] = useState(true);
  const [refCur, setRefCur] = useState('');
  const [refRate, setRefRate] = useState('');
  const [tcsPct, setTcsPct] = useState('');
  const [tdsPct, setTdsPct] = useState('');
  const [reference, setReference] = useState('');
  const [subject, setSubject] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [billDiscount, setBillDiscount] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [extra, setExtra] = useState<{ label: string; value: string }[]>([]);
  const [customDefs, setCustomDefs] = useState<CustomDef[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [paidNow, setPaidNow] = useState(false);
  const [paidVia, setPaidVia] = useState('cash');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewErr, setPreviewErr] = useState('');
  const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const quote = docType === 'estimate' || docType === 'proforma' || docType === 'sales_order';
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
  // Undo and redo for the lines table. Quick typing in one box counts as one step; adding, copying, moving and removing lines each count as their own.
  const linesRef = useRef<Line[]>([]);
  const history = useRef<Line[][]>([]);
  const redoStack = useRef<Line[][]>([]);
  const lastEdit = useRef(0);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; msg?: string }>({ kind: 'idle' });
  const serverIdRef = useRef<string | null>(null);
  const baseRevRef = useRef<number | null>(null);
  const autoFlight = useRef(false);
  const lastSaved = useRef('');
  const dragKey = useRef<number | null>(null);
  const inFlight = useRef(false); // set synchronously, so a double click cannot start two saves

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const fill = (p: Record<string, any>) => {
    setDocType(p.docType); setPartyId(p.partyId ?? ''); setDocDate(p.docDate ?? ''); setDueDate(p.dueDate ?? ''); setNotes(p.notes ?? ''); setTerms(p.terms ?? '');
    setRcm(!!p.reverseCharge); setOriginal(p.originalDocumentId ?? null); setTcsPct(bpToPct(p.tcsBp)); setTdsPct(bpToPct(p.tdsBp)); setCurrency(p.currency ?? 'INR'); setRate(p.exchangeRate ?? ''); setRefCur(p.displayCurrency ?? ''); setRefRate(p.displayRate ?? ''); setAdjustment(p.adjustment ?? ''); setAdjLabel(p.adjustmentLabel ?? ''); setRoundTotal(p.roundTotal !== false);
    setReference(p.reference ?? ''); setSubject(p.subject ?? ''); setPaymentTerms(p.paymentTerms ?? ''); setSalesperson(p.salesperson ?? ''); setExtra(p.extra ?? []); setCustom(p.custom ?? {});
    setLines((p.lines as any[]).map((l) => ({ key: seq++, itemId: l.itemId ?? null, name: l.name, hsnSac: l.hsnSac ?? '', quantity: String(l.quantity), rate: String(l.rate),
      discount: l.discount ?? '', taxRateBp: l.taxRateBp, kind: l.kind ?? 'goods', taxInclusive: !!l.taxInclusive })));
    history.current = []; redoStack.current = [];
  };

  useEffect(() => {
    (async () => {
      try {
        setParties(await fromServerOrDevice<Party[]>('parties', '/api/parties', (r) => r.parties, []));
        setItems(await fromServerOrDevice<Item[]>('items', '/api/items', (r) => r.items, []));
        setCustomDefs(await fromServerOrDevice<CustomDef[]>('custom-fields-doc', '/api/custom-fields?entity=document', (r) => r.fields, []));
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
            setRcm(d.reverse_charge); setOriginal(d.original_document_id); setTcsPct(bpToPct(d.tcs_bp)); setTdsPct(bpToPct(d.tds_bp)); setCurrency(d.currency ?? 'INR'); setRate(d.currency && d.currency !== 'INR' ? microToText(d.exchange_rate_micro) : ''); setAdjustment(BigInt(d.adjustment_paise ?? 0) !== 0n ? `${BigInt(d.adjustment_paise) < 0n ? '-' : ''}${rs(String(BigInt(d.adjustment_paise) < 0n ? -BigInt(d.adjustment_paise) : BigInt(d.adjustment_paise)))}` : ''); setAdjLabel(d.adjustment_label ?? ''); setRoundTotal(d.round_total !== false); setRefCur(d.display_currency ?? ''); setRefRate(d.display_currency && d.display_rate_micro ? microToText(d.display_rate_micro) : '');
            setReference(d.reference ?? ''); setSubject(d.subject ?? ''); setPaymentTerms(d.payment_terms ?? ''); setSalesperson(d.salesperson ?? ''); setExtra(d.extra ?? []);
            setCustom(Object.fromEntries(((d.custom_values ?? []) as { id: string; value: string }[]).map((v) => [v.id, v.value])));
            setLines(ls.map((l: any) => ({ key: seq++, itemId: l.item_id, name: l.item_name, hsnSac: l.hsn_sac ?? '', quantity: String(l.quantity).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '1',
              rate: rs(l.rate_paise), discount: BigInt(l.discount_paise) > 0n ? rs(l.discount_paise) : '', taxRateBp: l.tax_rate_bp, kind: 'goods', taxInclusive: !!l.price_includes_tax })));
          } catch (e) {
            setErr(isNetworkError(e) ? 'This draft is on the server and cannot be opened while you are offline.' : (e as Error).message); return;
          }
        } else {
          setClientRef(newId());
          try {
            const b = await fromServerOrDevice<any>('business-defaults', '/api/business', (r) => r.business, null);
            if (b?.default_notes) setNotes(b.default_notes);
            if (b?.default_terms) setTerms(b.default_terms);
          } catch { /* the defaults are a convenience */ }
        }
        setReady(true);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [draftId, localIdProp]);

  // A new quote is valid for 30 days unless the person picks another date.
  useEffect(() => {
    if (!ready || docType !== 'estimate' || dueDate || draftId || localIdProp) return;
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); d.setUTCDate(d.getUTCDate() + 30);
    setDueDate(d.toISOString().slice(0, 10));
  }, [ready, docType]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = useMemo(() => ({
    docType, partyId: partyId || null, docDate: docDate || undefined, dueDate: dueDate || null, notes, terms, reverseCharge,
    originalDocumentId: original, tcsBp: pctToBp(tcsPct) ?? 0, tdsBp: pctToBp(tdsPct) ?? 0,
    reference: reference.trim() || null, subject: subject.trim() || null, paymentTerms: paymentTerms || null, salesperson: salesperson.trim() || null,
    extra: extra.filter((x) => x.label.trim() || x.value.trim()),
    custom: Object.fromEntries(Object.entries(custom).filter(([id, v]) => v.trim() && customDefs.some((d) => d.id === id))),
    ...(currency !== 'INR' && quote ? { currency, exchangeRate: rate } : {}),
    ...(adjustment.trim() ? { adjustment: adjustment.trim(), adjustmentLabel: adjLabel.trim() || undefined } : {}),
    ...(roundTotal ? {} : { roundTotal: false }),
    ...(currency === 'INR' && refCur ? { displayCurrency: refCur, displayRate: refRate } : {}),
    lines: (() => {
      const kept = lines.filter((l) => l.name.trim() || l.rate);
      const disc = effectiveDiscounts(kept, billDiscount);
      return kept.map((l, i) => ({ itemId: l.itemId, name: l.name, hsnSac: l.hsnSac || null, quantity: l.quantity || '0',
        rate: l.rate || '0', discount: disc[i] || undefined, taxRateBp: l.taxRateBp, kind: l.kind, taxInclusive: l.taxInclusive || undefined }));
    })(),
  }), [docType, partyId, docDate, dueDate, notes, terms, reverseCharge, lines, original, tcsPct, tdsPct, currency, rate, quote, reference, subject, paymentTerms, billDiscount, salesperson, extra, custom, customDefs, refCur, refRate, adjustment, adjLabel, roundTotal]);

  // Autosave. Once there is something worth keeping, the draft is saved a couple of seconds after the last change and the screen says so.
  // Existing drafts are saved in place; a new one is made on the first save and then updated. Nothing is issued by this.
  const payloadKey = JSON.stringify(payload);
  useEffect(() => { if (serverId) serverIdRef.current = serverId; if (baseRev !== null) baseRevRef.current = baseRev; }, [serverId, baseRev]);
  useEffect(() => { if (ready && !lastSaved.current && (draftId || localIdProp)) lastSaved.current = payloadKey; }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !online || busy || local?.conflict) return;
    if (payloadKey === lastSaved.current) return;
    if (!payload.lines.some((l) => l.name.trim() && l.rate)) return;
    const h = setTimeout(async () => {
      if (inFlight.current || autoFlight.current) return;
      autoFlight.current = true; setSaveState({ kind: 'saving' });
      try {
        const body = { ...payload, clientRef, ...(baseRevRef.current !== null ? { baseRev: baseRevRef.current } : {}) };
        const r = await api(serverIdRef.current ? `/api/documents/${serverIdRef.current}` : '/api/documents', { method: serverIdRef.current ? 'PUT' : 'POST', body });
        serverIdRef.current = r.id; baseRevRef.current = r.rev ?? baseRevRef.current; setServerId(r.id); if (r.rev !== undefined) setBaseRev(r.rev);
        lastSaved.current = payloadKey;
        setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
      } catch (e) {
        setSaveState({ kind: 'error', msg: e instanceof ApiError && e.status === 409 ? 'This draft was changed on another device.' : (e as Error).message });
      } finally { autoFlight.current = false; }
    }, 2500);
    return () => clearTimeout(h);
  }, [payloadKey, ready, online, busy, local]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The paper preview is drawn by the server with the same renderer as the PDF. Only fetched while the Preview tab is open.
  useEffect(() => {
    if (view !== 'preview' || !ready) return;
    if (payload.lines.length === 0) { setPreviewHtml(''); setPreviewErr('Add a line to see the document.'); return; }
    const h = setTimeout(async () => {
      try { setPreviewHtml((await api('/api/documents/preview-html', { body: payload })).html); setPreviewErr(''); }
      catch (e) { setPreviewHtml(''); setPreviewErr(isNetworkError(e) ? 'The preview needs a connection. Your totals are still worked out on this device.' : (e as Error).message); }
    }, 400);
    return () => clearTimeout(h);
  }, [view, payload, ready]);

  linesRef.current = lines;
  const change = (fn: (ls: Line[]) => Line[], structural = false) => {
    const now = Date.now();
    if (structural || now - lastEdit.current > 800) { history.current.push(linesRef.current); if (history.current.length > 100) history.current.shift(); }
    lastEdit.current = structural ? 0 : now;
    redoStack.current = [];
    const next = fn(linesRef.current);
    linesRef.current = next;
    setLines(next);
  };
  const undo = () => { const p = history.current.pop(); if (!p) return; redoStack.current.push(linesRef.current); linesRef.current = p; lastEdit.current = 0; setLines(p); };
  const redo = () => { const n = redoStack.current.pop(); if (!n) return; history.current.push(linesRef.current); linesRef.current = n; lastEdit.current = 0; setLines(n); };
  const setLine = (key: number, patch: Partial<Line>) => change((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Moves keyboard focus to a box on a line, once the screen has drawn it. */
  const focusCell = (key: number, col: string) => setTimeout(() => (document.querySelector(`[data-line="${key}"][data-col="${col}"]`) as HTMLElement | null)?.focus(), 0);
  const addLineAfter = (key: number | null) => {
    const fresh = blankLine();
    change((ls) => { const at = key === null ? ls.length : ls.findIndex((l) => l.key === key) + 1; return [...ls.slice(0, at), fresh, ...ls.slice(at)]; }, true);
    focusCell(fresh.key, 'name');
  };
  const duplicateLine = (key: number) => {
    const copy = { ...linesRef.current.find((l) => l.key === key)!, key: seq++ };
    change((ls) => { const at = ls.findIndex((l) => l.key === key) + 1; return [...ls.slice(0, at), copy, ...ls.slice(at)]; }, true);
    focusCell(copy.key, 'name');
  };
  const moveLine = (key: number, by: number, col = 'name') => {
    change((ls) => {
      const from = ls.findIndex((l) => l.key === key), to = from + by;
      if (from < 0 || to < 0 || to >= ls.length) return ls;
      const next = [...ls]; const [m] = next.splice(from, 1); next.splice(to, 0, m!); return next;
    }, true);
    focusCell(key, col);
  };
  const dropLine = (target: number) => {
    const from = dragKey.current; dragKey.current = null;
    if (from === null || from === target) return;
    change((ls) => { const next = [...ls]; const a = next.findIndex((l) => l.key === from); const [m] = next.splice(a, 1); next.splice(next.findIndex((l) => l.key === target), 0, m!); return next; }, true);
  };
  /** Keys inside the lines table: Enter goes down a row (a new one at the end), Ctrl+D copies, Alt+Up and Alt+Down move, Ctrl+Z undoes. */
  const onLinesKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const key = Number(el.getAttribute('data-line')), col = el.getAttribute('data-col') ?? 'name';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
    if (Number.isNaN(key)) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLine(key); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveLine(key, e.key === 'ArrowUp' ? -1 : 1, col); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod && el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox') {
      e.preventDefault();
      const ls = linesRef.current; const at = ls.findIndex((l) => l.key === key);
      if (at === ls.length - 1) addLineAfter(key); else focusCell(ls[at + 1]!.key, col);
    }
  };
  const pickName = (key: number, name: string) => {
    const it = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    setLine(key, it ? { name, itemId: it.id, hsnSac: it.hsn_sac ?? '', rate: rs(it.price_paise), taxRateBp: it.default_rate_bp, kind: it.kind, taxInclusive: !!it.price_includes_tax } : { name, itemId: null });
    // A customer with a price list gets that list's price. Only a convenience at entry: offline, or on any failure, the item's own price stays.
    if (it && partyId && !original) {
      api(`/api/price-lists/resolve?item=${it.id}&party=${partyId}`).then((r) => {
        if (r.source === 'list') setLines((ls) => ls.map((l) => (l.key === key && l.itemId === it.id && l.rate === rs(it.price_paise) ? { ...l, rate: rs(r.pricePaise), taxInclusive: !!r.priceIncludesTax } : l)));
      }).catch(() => {});
    }
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
    for (let i = 0; i < 100 && autoFlight.current; i++) await new Promise((r) => setTimeout(r, 100));
    if (pctToBp(tcsPct) === null || pctToBp(tdsPct) === null) { setErr('Enter TCS and TDS as a percentage between 0 and 100, with at most two decimals.'); return; }
    if (issue && !online) { setErr('Issuing needs a connection. Save the draft now and issue it when you are back online.'); return; }
    inFlight.current = true;
    setErr(''); setBusy(true); setSavedLocally(false);
    const release = () => { setBusy(false); inFlight.current = false; };
    try {
      const sid = serverIdRef.current ?? serverId, rev = baseRevRef.current ?? baseRev;
      const body = { ...payload, clientRef, ...(rev !== null ? { baseRev: rev } : {}) };
      let r: any;
      try {
        r = await api(sid ? `/api/documents/${sid}` : '/api/documents', { method: sid ? 'PUT' : 'POST', body });
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
      if (issue) {
        await api(`/api/documents/${r.id}/issue`, { body: {} });
        // Pay at the counter: the money is recorded in the same step, so the invoice goes out already settled.
        if (paidNow && ['tax_invoice', 'bill_of_supply'].includes(docType)) {
          try {
            // The total comes from the saved document, never from the live preview, which may still be on its way.
            const total = (await api(`/api/documents/${r.id}`)).document.grand_total_paise as string;
            if (BigInt(total) > 0n) await api(`/api/documents/${r.id}/payments`, { body: { amount: rs(total), method: paidVia } });
          }
          catch (e) { window.location.href = `/app/invoices/${r.id}?payfail=${encodeURIComponent((e as Error).message)}`; return; }
        }
      }
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

  // The same total in the other currency, so the person sees both before issuing.
  const both = (() => {
    if (!totals) return '';
    try {
      const grand = BigInt(totals.grandTotal);
      if (currency !== 'INR' && rate) { const m = BigInt(Math.round(parseFloat(rate) * 1_000_000)); return m > 0n ? `About ${rupeesInr((grand * m + 500_000n) / 1_000_000n)} at 1 ${currency} = Rs ${rate}` : ''; }
      if (currency === 'INR' && refCur && refRate) { const m = BigInt(Math.round(parseFloat(refRate) * 1_000_000)); return m > 0n ? `About ${formatMoney((grand * 1_000_000n + m / 2n) / m, refCur)} at 1 ${refCur} = Rs ${refRate}` : ''; }
    } catch { /* a half-typed rate shows nothing */ }
    return '';
  })();

  if (!ready) return <p className="muted">{err || 'Loading the draft'}</p>;

  const label = DOC_LABEL[docType] ?? 'document';
  const ncState = nc.gstin.trim().length >= 2 && STATE_NAMES[nc.gstin.trim().slice(0, 2)] ? nc.gstin.trim().slice(0, 2) : nc.stateCode;
  const title = localId || draftId ? 'Edit draft' : `New ${label.toLowerCase()}`;

  return (
    <>
      <div className="toolbar"><div><h1>{title}</h1><p className="page-sub">{quote ? (docType === 'sales_order' ? 'Confirm what the customer has ordered. Turn it into a delivery challan or an invoice when you are ready.' : 'Quote a price. Nothing here is a tax invoice until you turn it into one.') : 'Choose who it is for and what you are selling. Kora works out the tax as you type.'}</p></div></div>
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
      <p className="muted save-status" role="status" aria-live="polite" data-testid="save-status">{saveState.kind === 'saving' ? 'Saving the draft' : saveState.kind === 'saved' ? `Draft saved at ${saveState.at}` : saveState.kind === 'error' ? `Not saved yet: ${saveState.msg}` : 'The draft saves by itself once you have added an item.'}</p>
      {!online && <p className="warn" role="status" data-testid="offline-note">You are offline. Totals are worked out on this device and checked again when the draft syncs.</p>}
      <div className="editor">
      <div className="editor-main">
      <div className="tabs" role="tablist" aria-label="Editor view">
        <button type="button" role="tab" aria-selected={view === 'edit'} onClick={() => setView('edit')}>Edit</button>
        <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
      </div>
      {view === 'preview' && (
        <div className="paper-stage" role="tabpanel" aria-label="Document preview">
          {previewHtml ? <iframe className="preview" title="Draft preview" sandbox="" srcDoc={previewHtml} /> : <p className="muted" role="status">{previewErr || 'Preparing the preview'}</p>}
        </div>
      )}
      <div hidden={view === 'preview'}>
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
            {currency === 'INR' && (
              <div className="row" style={{ marginTop: 8 }}>
                <div><label htmlFor="rcur">Also show the total in</label>
                  <select id="rcur" value={refCur} onChange={(e) => setRefCur(e.target.value)}><option value="">Rupees only</option>{CURRENCIES.filter((c) => c !== 'INR').map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                {refCur && <div><label htmlFor="rfx">Exchange rate (Rs for 1 {refCur})</label><input id="rfx" inputMode="decimal" placeholder="83.25" value={refRate} onChange={(e) => setRefRate(e.target.value)} /></div>}
              </div>)}
            {quote && currency !== 'INR' && <p className="muted">This is a quote, not a tax invoice. When the customer accepts, it turns into an invoice in rupees at this rate.</p>}
          </div>
          <div>
            <label htmlFor="dt" style={{ marginTop: 0 }}>Document type</label>
            <select id="dt" value={docType} onChange={(e) => { setDocType(e.target.value); if (!['estimate', 'proforma', 'sales_order'].includes(e.target.value)) setCurrency('INR'); }} disabled={!!original}>
              {Object.entries(DOC_LABEL).filter(([k]) => original ? k === docType : !['credit_note', 'debit_note'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label htmlFor="dd">Date</label><input id="dd" type="date" value={docDate} onChange={(e) => {
            const v = e.target.value; setDocDate(v);
            const due = paymentTerms && paymentTerms !== 'custom' ? dueDateFor(v || todayLocal(), paymentTerms) : null;
            if (due) setDueDate(due);
          }} /></div>
          <div><label htmlFor="pt">Payment terms</label>
            <select id="pt" value={paymentTerms} onChange={(e) => {
              const k = e.target.value; setPaymentTerms(k);
              const due = k && k !== 'custom' ? dueDateFor(docDate || todayLocal(), k) : null;
              if (due) setDueDate(due);
            }}>
              <option value="">No terms</option>
              {PAYMENT_TERMS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select></div>
          <div><label htmlFor="du">{docType === 'estimate' ? 'Valid until' : docType === 'sales_order' ? 'Delivery by' : 'Due date'}</label><input id="du" type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); if (paymentTerms) setPaymentTerms('custom'); }} /></div>
          <div><label htmlFor="rf">Order or PO number</label><input id="rf" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
          <div><label htmlFor="sp">Salesperson</label><input id="sp" maxLength={80} value={salesperson} onChange={(e) => setSalesperson(e.target.value)} placeholder="Optional" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label htmlFor="sj">Subject</label><input id="sj" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="For example: Website redesign, phase 2" /></div>
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
      <div onKeyDown={onLinesKey}>
      <table className="t line-table" aria-label="Line items" aria-describedby="line-keys">
        <thead><tr><th>Item details</th><th className="n">Qty</th><th className="n">Rate{currency !== 'INR' ? ` (${currency})` : ''}</th><th className="n">Discount</th><th>GST</th><th className="n">Amount</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const idx = lines.filter((x) => x.name.trim() || x.rate).findIndex((x) => x.key === l.key);
            return (
              <tr key={l.key} draggable onDragStart={(e) => { dragKey.current = l.key; e.dataTransfer.effectAllowed = 'move'; }} onDragOver={(e) => { if (dragKey.current !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); dropLine(l.key); }}>
                <td className="item-cell" data-label="Description"><span className="drag-grip" aria-hidden="true" title="Drag to move this line">⋮⋮</span><input data-line={l.key} data-col="name" aria-label={`Line ${i + 1} description`} placeholder="Item or service" list="items-list" value={l.name} onChange={(e) => pickName(l.key, e.target.value)} />
                  <div className="item-sub"><div className="sub-field"><span aria-hidden="true">HSN/SAC</span><input data-line={l.key} data-col="hsn" aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" list="hsn-list" placeholder="Code or word" value={l.hsnSac} onChange={(e) => { const v = e.target.value.trim(); const hit = HSN_LIST.find((h) => h.code === v); setLine(l.key, hit?.bp !== undefined && !l.itemId ? { hsnSac: v, taxRateBp: hit.bp, kind: hit.kind } : { hsnSac: e.target.value }); }} /></div>
                    <label className="incl"><input type="checkbox" aria-label={`Line ${i + 1} price includes GST`} checked={l.taxInclusive} onChange={(e) => setLine(l.key, { taxInclusive: e.target.checked })} /> price has GST in it</label></div></td>
                <td className="n" data-label="Quantity"><input data-line={l.key} data-col="qty" aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></td>
                <td className="n" data-label="Rate"><input data-line={l.key} data-col="rate" aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} /></td>
                <td className="n" data-label="Discount"><input data-line={l.key} data-col="disc" aria-label={`Line ${i + 1} discount`} placeholder="Rs or %" inputMode="text" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} /></td>
                <td data-label="GST"><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(l.key, { taxRateBp: Number(e.target.value) })}>
                  {TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td className="n line-amount" data-label="Amount">{idx >= 0 && totals?.lines[idx]?.total ? rupees(totals.lines[idx]!.total) : ''}</td>
                <td className="line-remove">
                  <button type="button" className="link" aria-label={`Copy line ${i + 1}`} onClick={() => duplicateLine(l.key)}>Copy</button>{' '}
                  <button type="button" className="link" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => moveLine(l.key, -1)}>Up</button>{' '}
                  <button type="button" className="link" aria-label={`Move line ${i + 1} down`} disabled={i === lines.length - 1} onClick={() => moveLine(l.key, 1)}>Down</button>{' '}
                  {lines.length > 1 && <button type="button" className="link" aria-label={`Remove line ${i + 1}`} onClick={() => change((ls) => ls.filter((x) => x.key !== l.key), true)}>Remove</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="muted" id="line-keys" data-testid="line-keys">Enter moves down a line, and adds one at the end. Ctrl+D copies a line. Alt with the up or down arrow moves it. Ctrl+Z undoes, Ctrl+Y redoes.
        {' '}<button type="button" className="link" onClick={undo}>Undo</button> <button type="button" className="link" onClick={redo}>Redo</button></p>
      <datalist id="hsn-list">{HSN_LIST.map((h) => <option key={h.code} value={h.code}>{h.text}</option>)}</datalist>
      <datalist id="items-list">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
      <div className="items-foot">
        <button type="button" className="secondary sm" onClick={() => addLineAfter(null)}><Icon name="plus" size={16} />Add line</button>
        <button type="button" className="secondary sm" onClick={() => change((ls) => [...ls, { ...blankLine(), name: 'Shipping and handling', hsnSac: '996511', kind: 'service', taxRateBp: shippingRateBp(ls.filter((x) => x.name.trim() || x.rate).map((x) => x.taxRateBp)) }], true)}>Add shipping charge</button>
        <div className="bill-discount"><label htmlFor="bd">Discount on the whole bill</label>
          <input id="bd" inputMode="text" placeholder="Rs or %, for example 500 or 10%" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
          <span className="muted">Shared across the lines to the paisa, so the tax stays right on each line.</span></div>
        <div className="bill-discount"><label htmlFor="adj">Adjustment on the total</label>
          <div className="row">
            <input id="adj" inputMode="text" placeholder="For example -5 or 12.50" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
            <input aria-label="Adjustment name" maxLength={40} placeholder="Name, for example Goodwill" value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} />
          </div>
          <span className="muted">Added to or taken off the total after tax. It is not taxed and is printed as its own line.</span>
          {currency === 'INR' && <label className="incl"><input type="checkbox" checked={roundTotal} onChange={(e) => setRoundTotal(e.target.checked)} /> Round the total to the nearest rupee</label>}</div>
      </div>
      </section>

      <section className="panel" aria-label="Notes and extras">
      <p className="section-label">Notes and extras</p>
      <div>
        <div>
          <p className="section-label" style={{ marginTop: 0 }}>Extra details printed under the header</p>
          {extra.map((x, i) => (
            <div className="extra-row" key={i}>
              <input aria-label={`Extra detail ${i + 1} name`} placeholder="Name, for example Vehicle no." maxLength={40} value={x.label} onChange={(e) => setExtra((xs) => xs.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)))} />
              <input aria-label={`Extra detail ${i + 1} value`} placeholder="Value" maxLength={120} value={x.value} onChange={(e) => setExtra((xs) => xs.map((y, k) => (k === i ? { ...y, value: e.target.value } : y)))} />
              <button type="button" className="link" aria-label={`Remove extra detail ${i + 1}`} onClick={() => setExtra((xs) => xs.filter((_, k) => k !== i))}>Remove</button>
            </div>))}
          {extra.length < 5 && <button type="button" className="secondary sm" style={{ marginTop: 6 }} onClick={() => setExtra((xs) => [...xs, { label: '', value: '' }])}><Icon name="plus" size={16} />Add an extra detail</button>}
          {customDefs.length > 0 && (<><p className="section-label">Your own fields</p><CustomFieldInputs defs={customDefs} values={custom} onChange={setCustom} idPrefix="cf" /></>)}
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
              {BigInt(totals.adjustment ?? 0) !== 0n && <div><span>{adjLabel.trim() || 'Adjustment'}</span><span>{BigInt(totals.adjustment ?? 0) < 0n ? '-' : ''}{rupees(String(BigInt(totals.adjustment ?? 0) < 0n ? -BigInt(totals.adjustment ?? 0) : BigInt(totals.adjustment ?? 0)))}</span></div>}
              {BigInt(totals.roundOff) !== 0n && <div><span>Round off</span><span>{BigInt(totals.roundOff) < 0n ? '-' : ''}{rupees(BigInt(totals.roundOff) < 0n ? -BigInt(totals.roundOff) : totals.roundOff)}</span></div>}
              <div className="grand"><span>Total</span><span data-testid="grand-total">{rupees(totals.grandTotal)}</span></div>
              {both && <div className="muted" data-testid="both-currencies">{both}</div>}
              {BigInt(totals.tds) > 0n && <div className="muted" data-testid="tds-note">Customer deducts {rupees(totals.tds)} as TDS, so they pay <b>{rupees(totals.netReceivable)}</b>. Record the TDS as a payment when it arrives.</div>}
              <div className="muted">Place of supply: {STATE_NAMES[totals.placeOfSupply]} ({totals.supply === 'intra' ? 'within state' : 'other state'})</div>
              {totals.recommendedDocType === 'bill_of_supply' && docType === 'tax_invoice' && <div className="warn">Every line is at 0%. A bill of supply may be the right document.</div>}
              {totals.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
            </>) : <div className="muted">{hint || 'Add a line to see the total.'}</div>}
          </div>
          {['tax_invoice', 'bill_of_supply'].includes(docType) && pctToBp(tdsPct) === 0 && online && (
            <div className="paid-now">
              <label className="incl"><input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> The customer has paid in full</label>
              {paidNow && (
                <select aria-label="Paid by" value={paidVia} onChange={(e) => setPaidVia(e.target.value)}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select>)}
            </div>)}
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
