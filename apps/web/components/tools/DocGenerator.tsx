'use client';
import { useMemo, useState } from 'react';
import { computeDocument, formatRupees, parseQuantity, parseRupees, rupeesInWords, STATE_NAMES, isTaxError, type DocType } from '@kora/tax';

export type DocKind = 'invoice' | 'quotation' | 'proforma' | 'purchase-order' | 'receipt';

const KINDS: Record<DocKind, { title: string; tax: DocType; from: string; to: string; numberLabel: string; dateLabel: string; dueLabel: string | null }> = {
  invoice: { title: 'TAX INVOICE', tax: 'tax_invoice', from: 'From (your business)', to: 'Bill to', numberLabel: 'Invoice number', dateLabel: 'Invoice date', dueLabel: 'Due date' },
  quotation: { title: 'QUOTATION', tax: 'estimate', from: 'From (your business)', to: 'Quote for', numberLabel: 'Quotation number', dateLabel: 'Date', dueLabel: 'Valid until' },
  proforma: { title: 'PROFORMA INVOICE', tax: 'proforma', from: 'From (your business)', to: 'Bill to', numberLabel: 'Proforma number', dateLabel: 'Date', dueLabel: 'Valid until' },
  'purchase-order': { title: 'PURCHASE ORDER', tax: 'estimate', from: 'Order from (supplier)', to: 'Ship to and bill to (your business)', numberLabel: 'PO number', dateLabel: 'Order date', dueLabel: 'Deliver by' },
  receipt: { title: 'PAYMENT RECEIPT', tax: 'estimate', from: 'Received by (your business)', to: 'Received from', numberLabel: 'Receipt number', dateLabel: 'Date received', dueLabel: null },
};
// Rates in force since 22 September 2025. The older 12% and 28% slabs only apply to supplies made before that date.
const RATES = [0, 3, 5, 18, 40];
const METHODS = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'];
type Party = { name: string; gstin: string; address: string; state: string };
type Line = { desc: string; hsn: string; qty: string; rate: string; gst: number };
const today = () => new Date().toLocaleDateString('en-CA');
const blankParty = (state = '27'): Party => ({ name: '', gstin: '', address: '', state });

/** A document maker that runs in the browser. Totals use the same tax library as Kora invoices. Print it, or save it as a PDF from the print window. */
export default function DocGenerator({ kind }: { kind: DocKind }) {
  const k = KINDS[kind];
  const isReceipt = kind === 'receipt';
  const [gst, setGst] = useState(true);
  const [me, setMe] = useState<Party>(blankParty());
  const [them, setThem] = useState<Party>(blankParty());
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const [due, setDue] = useState('');
  const [lines, setLines] = useState<Line[]>([{ desc: '', hsn: '', qty: '1', rate: '', gst: 18 }]);
  const [notes, setNotes] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('UPI');
  const [towards, setTowards] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [logo, setLogo] = useState('');
  const [logoErr, setLogoErr] = useState('');
  const [accent, setAccent] = useState('');
  const pickLogo = (f: File | undefined) => {
    setLogoErr('');
    if (!f) { setLogo(''); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setLogoErr('Choose a PNG, JPG or WebP picture.'); return; }
    if (f.size > 1024 * 1024) { setLogoErr('Choose a picture under 1 MB.'); return; }
    const r = new FileReader();
    r.onload = () => setLogo(String(r.result));
    r.readAsDataURL(f);
  };

  const calc = useMemo(() => {
    if (isReceipt) return null;
    try {
      const used = lines.filter((l) => l.desc.trim() || l.rate.trim());
      if (!used.length) return { err: 'Add at least one line.' } as const;
      const r = computeDocument({
        docType: gst ? k.tax : 'estimate', registrationType: gst ? 'regular' : 'unregistered', supplierState: me.state, placeOfSupply: them.state || me.state, roundTotal: true,
        lines: used.map((l) => ({ quantityMilli: parseQuantity(l.qty || '0'), ratePaise: parseRupees(l.rate || '0'), taxRateBp: gst ? l.gst * 100 : 0 })),
      });
      return { r, used } as const;
    } catch (e) { return { err: isTaxError(e) ? e.message : 'Check the quantities and rates. Use numbers only.' } as const; }
  }, [lines, gst, me.state, them.state, k.tax, isReceipt]);

  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const party = (p: Party, set: (p: Party) => void, id: string, label: string) => (
    <fieldset className="tl-fs"><legend>{label}</legend>
      <label htmlFor={`${id}n`}>Name</label><input id={`${id}n`} value={p.name} onChange={(e) => set({ ...p, name: e.target.value })} />
      {gst && <><label htmlFor={`${id}g`}>GSTIN (optional)</label><input id={`${id}g`} value={p.gstin} maxLength={15} onChange={(e) => set({ ...p, gstin: e.target.value.toUpperCase() })} /></>}
      <label htmlFor={`${id}a`}>Address</label><textarea id={`${id}a`} rows={2} value={p.address} onChange={(e) => set({ ...p, address: e.target.value })} />
      <label htmlFor={`${id}s`}>State</label>
      <select id={`${id}s`} value={p.state} onChange={(e) => set({ ...p, state: e.target.value })}>
        {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </select>
    </fieldset>
  );
  const paidPaise = (() => { try { return paid ? parseRupees(paid) : 0n; } catch { return 0n; } })();
  const ok = calc && 'r' in calc ? calc.r : null;
  const totalText = isReceipt ? formatRupees(paidPaise) : ok ? formatRupees(ok.grandTotalPaise) : '';
  const summary = `${k.title}${number ? ` ${number}` : ''}\n${me.name || 'My business'} to ${them.name || 'customer'}${totalText ? `\nTotal ${totalText}` : ''}`;
  const SWATCHES = ['', '#106cd9', '#0b7d3e', '#c43a2f', '#6a3fb5', '#b45309'];

  return (
    <>
    <div className="vt-tabs no-print" role="group" aria-label="Show">
      <button type="button" aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>Enter details</button>
      <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
    </div>
    <div className="tl-split" data-tab={tab}>
      <form className="tl-form no-print" onSubmit={(e) => e.preventDefault()} aria-label={`${k.title} details`}>
        <label htmlFor="lg">Company logo (PNG, JPG or WebP, under 1 MB)</label>
        <input id="lg" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickLogo(e.target.files?.[0])} />
        {logoErr && <p className="error" role="alert">{logoErr}</p>}
        <fieldset className="tl-fs"><legend>Colour</legend><div className="tl-chips" role="radiogroup" aria-label="Document colour">
          {SWATCHES.map((c) => <button key={c || 'black'} type="button" role="radio" aria-checked={accent === c} aria-label={c || 'Black'} className="tl-swatch" style={{ background: c || '#171b20', outlineColor: accent === c ? 'var(--text)' : 'transparent' }} onClick={() => setAccent(c)} />)}
        </div></fieldset>
        {!isReceipt && <label className="tl-check"><input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} /> I am registered for GST (adds tax lines)</label>}
        {party(me, setMe, 'me', k.from)}
        {party(them, setThem, 'th', k.to)}
        <div className="tl-row">
          <div><label htmlFor="dn">{k.numberLabel}</label><input id="dn" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
          <div><label htmlFor="dd">{k.dateLabel}</label><input id="dd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {k.dueLabel && <div><label htmlFor="du">{k.dueLabel}</label><input id="du" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
        </div>
        {isReceipt ? (
          <fieldset className="tl-fs"><legend>Payment</legend>
            <label htmlFor="pa">Amount received (Rs)</label><input id="pa" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
            <label htmlFor="pm">Paid by</label><select id="pm" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <label htmlFor="pt">Towards</label><input id="pt" value={towards} onChange={(e) => setTowards(e.target.value)} placeholder="for example Invoice INV-0042" />
          </fieldset>
        ) : (
          <fieldset className="tl-fs"><legend>Items</legend>
            {lines.map((l, i) => (
              <div className="tl-line" key={i}>
                <label htmlFor={`l${i}d`}>Item {i + 1} description</label><input id={`l${i}d`} value={l.desc} onChange={(e) => setLine(i, { desc: e.target.value })} />
                <div className="tl-row4">
                  {gst && <div><label htmlFor={`l${i}h`}>HSN or SAC</label><input id={`l${i}h`} value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value })} /></div>}
                  <div><label htmlFor={`l${i}q`}>Quantity</label><input id={`l${i}q`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
                  <div><label htmlFor={`l${i}r`}>Rate (Rs)</label><input id={`l${i}r`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></div>
                  {gst && <div><label htmlFor={`l${i}g`}>GST %</label><select id={`l${i}g`} value={l.gst} onChange={(e) => setLine(i, { gst: Number(e.target.value) })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>}
                </div>
                {lines.length > 1 && <button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove item {i + 1}</button>}
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setLines([...lines, { desc: '', hsn: '', qty: '1', rate: '', gst: 18 }])}>Add another item</button>
          </fieldset>
        )}
        <label htmlFor="nt">Notes and terms</label><textarea id="nt" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
        <p className="muted">In the print window, choose &quot;Save as PDF&quot; as the printer. Nothing you type here leaves your device.</p>
      </form>

      <div className="tl-preview" aria-label="Preview">
        <article className="doc-sheet" style={accent ? ({ '--doc-accent': accent } as React.CSSProperties) : undefined}>
          <header><div>{logo && <img className="doc-logo" src={logo} alt="Company logo" />}<b>{me.name || 'Your business name'}</b><div className="small">{me.address}</div>{gst && me.gstin && <div className="small">GSTIN {me.gstin}</div>}</div><div className="doc-title">{k.title}</div></header>
          <div className="doc-meta">
            <div><span className="small">{k.to}</span><b>{them.name || 'Name'}</b><div className="small">{them.address}</div>{gst && them.gstin && <div className="small">GSTIN {them.gstin}</div>}</div>
            <div className="right"><div className="small">{k.numberLabel}: <b>{number || '-'}</b></div><div className="small">{k.dateLabel}: <b>{date}</b></div>{k.dueLabel && due && <div className="small">{k.dueLabel}: <b>{due}</b></div>}</div>
          </div>
          {isReceipt ? (
            <div className="doc-receipt">
              <p>Received with thanks <b>{formatRupees(paidPaise)}</b> ({paidPaise > 0n ? rupeesInWords(paidPaise) : 'amount in words'}) from <b>{them.name || 'the payer'}</b> by <b>{method}</b>{towards ? <> towards <b>{towards}</b></> : null}.</p>
            </div>
          ) : calc && 'err' in calc ? <p className="doc-err" role="status">{calc.err}</p> : ok && calc && 'used' in calc ? (
            <>
              <table><thead><tr><th>#</th><th>Item</th>{gst && <th>HSN or SAC</th>}<th className="n">Qty</th><th className="n">Rate</th>{gst && <th className="n">GST</th>}<th className="n">Amount</th></tr></thead>
                <tbody>{ok.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{calc.used[i]!.desc}</td>{gst && <td>{calc.used[i]!.hsn}</td>}<td className="n">{calc.used[i]!.qty}</td><td className="n">{formatRupees(parseRupees(calc.used[i]!.rate || '0'))}</td>{gst && <td className="n">{calc.used[i]!.gst}%</td>}<td className="n">{formatRupees(l.taxablePaise)}</td></tr>)}</tbody></table>
              <dl className="doc-totals">
                <div><dt>{gst ? 'Taxable value' : 'Subtotal'}</dt><dd>{formatRupees(ok.taxablePaise)}</dd></div>
                {gst && ok.cgstPaise > 0n && <><div><dt>CGST</dt><dd>{formatRupees(ok.cgstPaise)}</dd></div><div><dt>SGST</dt><dd>{formatRupees(ok.sgstPaise)}</dd></div></>}
                {gst && ok.igstPaise > 0n && <div><dt>IGST</dt><dd>{formatRupees(ok.igstPaise)}</dd></div>}
                {ok.roundOffPaise !== 0n && <div><dt>Round off</dt><dd>{formatRupees(ok.roundOffPaise)}</dd></div>}
                <div className="grand"><dt>Total</dt><dd data-testid="doc-total">{formatRupees(ok.grandTotalPaise)}</dd></div>
              </dl>
              <p className="small">{rupeesInWords(ok.grandTotalPaise)}</p>
            </>
          ) : null}
          {notes && <p className="small doc-notes">{notes}</p>}
          <footer className="small">Made with Kora free tools. A sample made here is not a legal or tax opinion.</footer>
        </article>
        <div className="tl-actions no-print">
          <a className="btn secondary" href={`https://wa.me/?text=${encodeURIComponent(summary)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
          <a className="btn secondary" href={`mailto:?subject=${encodeURIComponent(k.title + (number ? ` ${number}` : ''))}&body=${encodeURIComponent(summary)}`}>Share by email</a>
        </div>
      </div>
    </div>
    </>
  );
}
