'use client';
import { useState } from 'react';
import { api, rupees } from '../lib/client';

type Doc = { ref: string; firstLine: number; customer: string; date: string | null; lines: number; status: 'ok' | 'error' | 'existing'; message: string | null; totalPaise: string | null };
type Preview = { counts: { total: number; ok: number; existing: number; error: number }; docs: Doc[] };
type Result = { created: number; existing: number; failed: number; ids: string[]; problems: { ref: string; line: number; message: string }[] };

const toBase64 = async (f: File) => {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Invoices from a spreadsheet, as drafts. Check them here, then look at each draft before you issue it. */
export default function InvoiceImport() {
  const [docType, setDocType] = useState('tax_invoice');
  const [body, setBody] = useState<Record<string, string> | null>(null);
  const [name, setName] = useState('');
  const [p, setP] = useState<Preview | null>(null);
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async (b: Record<string, string>, type: string) => {
    setBusy(true); setErr(''); setP(null);
    try { setP((await api('/api/data/import-invoices', { body: { ...b, docType: type } })).preview); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const choose = async (f: File | undefined) => {
    setR(null); setErr(''); setP(null); setBody(null); setName('');
    if (!f) return;
    const xlsx = f.name.toLowerCase().endsWith('.xlsx');
    if (f.size > (xlsx ? 10_000_000 : 1_000_000)) { setErr(xlsx ? 'The Excel file is larger than 10 MB. Split it into smaller files.' : 'The file is larger than 1 MB. Split it into smaller files.'); return; }
    const b: Record<string, string> = xlsx ? { xlsx: await toBase64(f) } : { csv: await f.text() };
    setBody(b); setName(f.name);
    await check(b, docType);
  };
  const commit = async () => {
    if (!body) return;
    setBusy(true); setErr('');
    try { setR((await api('/api/data/import-invoices', { body: { ...body, docType, commit: true } })).result); setP(null); setBody(null); setName(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="panel" aria-label="Import invoices">
      <h2>Import invoices as drafts</h2>
      <p className="muted">One row for each line, with a column for the invoice reference so lines can be grouped. Needs the customer, the item and the rate. Customers must already be in Kora. Kora numbers an invoice when you issue it, so the old number is kept as the reference. Nothing is issued here.</p>
      <div className="row">
        <div><label htmlFor="iid">Make them</label>
          <select id="iid" value={docType} onChange={(e) => { setDocType(e.target.value); if (body) void check(body, e.target.value); }}>
            <option value="tax_invoice">Tax invoices</option><option value="bill_of_supply">Bills of supply</option><option value="estimate">Estimates</option><option value="proforma">Proforma invoices</option></select></div>
        <div><label htmlFor="iif">Invoice file (CSV or Excel)</label><input id="iif" type="file" accept=".csv,text/csv,.xlsx" onChange={(e) => void choose(e.target.files?.[0])} /></div>
      </div>
      <p className="muted">Recognised headings include Invoice Number, Invoice Date, Due Date, Customer Name, Item Name, HSN/SAC, Quantity, Rate, GST %, Discount and Notes.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {busy && <p className="muted" role="status">Working</p>}
      {p && (
        <div data-testid="invoice-import-preview">
          <p><b>{name}</b>: <span data-testid="inv-ok">{p.counts.ok}</span> ready, <span data-testid="inv-existing">{p.counts.existing}</span> already imported, <span data-testid="inv-err">{p.counts.error}</span> with a problem.</p>
          <table className="t" aria-label="Invoices found">
            <thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th className="n">Lines</th><th className="n">Total</th><th>What will happen</th></tr></thead>
            <tbody>{p.docs.map((d) => (
              <tr key={`${d.ref}-${d.firstLine}`}><td>{d.ref || `Row ${d.firstLine}`}</td><td>{d.customer}</td><td>{d.date ?? ''}</td><td className="n">{d.lines}</td><td className="n">{d.totalPaise ? rupees(d.totalPaise) : ''}</td>
                <td>{d.status === 'error' ? <span className="error">{d.message}</span> : d.status === 'existing' ? <span className="muted">{d.message}</span> : <span className="ok">A draft will be made{d.message ? ` (${d.message})` : ''}</span>}</td></tr>))}</tbody>
          </table>
          {p.counts.ok > 0 ? <button disabled={busy} onClick={() => void commit()}>Make {p.counts.ok} draft{p.counts.ok === 1 ? '' : 's'}</button> : <p className="muted">There is nothing new to make.</p>}
          {p.counts.error > 0 && p.counts.ok > 0 && <p className="muted">Invoices with a problem are left out. Fix them in your sheet and import the file again; the ones already made are not repeated.</p>}
        </div>)}
      {r && (
        <div className="ok" role="status" data-testid="invoice-import-result">
          <p>Done. <b>{r.created}</b> draft{r.created === 1 ? '' : 's'} made, {r.existing} already there, {r.failed} left out. <a href="/app/invoices?type=tax_invoice">Open your documents</a> to check and issue them.</p>
          {r.problems.length > 0 && <ul>{r.problems.slice(0, 20).map((x) => <li key={`${x.ref}-${x.line}`}>{x.ref || `Row ${x.line}`}: {x.message}</li>)}</ul>}
        </div>)}
    </section>
  );
}
