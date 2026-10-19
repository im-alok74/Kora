'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type PreviewRow = { line: number; status: 'ok' | 'duplicate' | 'error'; message: string | null; name: string };
type Preview = { kind: string; columns: { mapped: string[]; ignored: string[] }; counts: { total: number; ok: number; duplicate: number; error: number }; rows: PreviewRow[] };
type Result = { created: number; skipped: number; failed: number; problems: { line: number; name: string; message: string }[] };

const DATASETS: [string, string][] = [['customers', 'Customers'], ['items', 'Items'], ['documents', 'Documents'], ['document_lines', 'Document lines'], ['payments', 'Payments'], ['expenses', 'Expenses']];
const LEDGERS: [string, string, string][] = [
  ['company', 'Tally company (leave empty to use your business name)', ''], ['salesLedger', 'Sales ledger', 'Sales'], ['cgstLedger', 'CGST ledger', 'Output CGST'],
  ['sgstLedger', 'SGST ledger', 'Output SGST'], ['igstLedger', 'IGST ledger', 'Output IGST'], ['cessLedger', 'Cess ledger', 'Output Cess'], ['tcsLedger', 'TCS ledger', 'TCS Payable'],
  ['roundOffLedger', 'Round off ledger', 'Round Off'], ['cashLedger', 'Cash ledger', 'Cash'], ['bankLedger', 'Bank ledger', 'Bank Account'], ['tdsLedger', 'TDS ledger', 'TDS Receivable'],
];
const TEMPLATES: Record<string, string> = {
  customers: 'Name,GSTIN,State,Mobile,Email,Address,City,Pincode,Currency\r\nAsha Stores,,Maharashtra,9876543210,asha@example.com,12 Main Road,Pune,411001,INR\r\n',
  items: 'Name,Type,HSN or SAC,Unit,GST percent,Price\r\nWidget,Goods,8471,NOS,18,250.00\r\nConsulting,Service,998313,HRS,18,2000.00\r\n',
};
const today = () => new Date().toLocaleDateString('en-CA');

export default function Data() {
  const [role, setRole] = useState('');
  const canExport = role === 'owner' || role === 'accountant';
  const canImport = role === 'owner' || role === 'staff';
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); }, []);

  // export
  const [sets, setSets] = useState<Record<string, boolean>>(Object.fromEntries(DATASETS.map(([k]) => [k, true])));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const chosen = DATASETS.map(([k]) => k).filter((k) => sets[k]);
  const xlsx = `/api/data/export?format=xlsx&datasets=${chosen.join(',')}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const [tf, setTf] = useState(() => today().slice(0, 8) + '01');
  const [tt, setTt] = useState(today);
  const [ledgers, setLedgers] = useState<Record<string, string>>(Object.fromEntries(LEDGERS.map(([k]) => [k, ''])));
  const tally = `/api/data/tally?from=${tf}&to=${tt}` + LEDGERS.filter(([k]) => ledgers[k]).map(([k]) => `&${k}=${encodeURIComponent(ledgers[k]!)}`).join('');

  // import
  const [kind, setKind] = useState<'customers' | 'items'>('customers');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const chooseFile = async (f: File | null) => {
    setPreview(null); setResult(null); setErr(''); setCsv(''); setFileName('');
    if (!f) return;
    if (f.size > 1_000_000) { setErr('The file is larger than 1 MB. Split it into smaller files.'); return; }
    const text = await f.text();
    setCsv(text); setFileName(f.name); setBusy(true);
    try { setPreview((await api('/api/data/import', { body: { kind, csv: text } })).preview); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const doImport = async () => {
    setBusy(true); setErr('');
    try { setResult((await api('/api/data/import', { body: { kind, csv, commit: true } })).result); setPreview(null); setCsv(''); setFileName(''); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + TEMPLATES[kind])}`;
  const shown = preview ? preview.rows.filter((r) => r.status !== 'ok').slice(0, 100) : [];

  return (
    <>
      <h1>Your data</h1>
      <p className="muted">Take your data out for a spreadsheet, your accountant or a backup, or bring customers and items in from a spreadsheet.</p>

      <section className="panel" aria-label="Export to Excel">
        <h2>Export to Excel</h2>
        {!canExport ? <p className="muted">Exports are for the owner and the accountant.</p> : (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted">Include</legend>
              <div className="row" style={{ justifyContent: 'flex-start' }}>
                {DATASETS.map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none', margin: 0 }}>
                    <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={sets[k]} onChange={(e) => setSets({ ...sets, [k]: e.target.checked })} /> {label}
                  </label>))}
              </div>
            </fieldset>
            <div className="row" style={{ marginTop: 8 }}>
              <div><label htmlFor="xf">Documents, payments and expenses from (optional)</label><input id="xf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label htmlFor="xt">To (optional)</label><input id="xt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            {chosen.length === 0 ? <p className="error" role="alert">Choose at least one thing to include.</p> : <a className="btn" href={xlsx}>Download Excel file</a>}
          </>)}
      </section>

      <section className="panel" aria-label="Backup">
        <h2>Full backup</h2>
        <p className="muted">Everything in one ZIP: a CSV for each kind of record, and one JSON file for other software. It does not include PDFs or receipt photos. Each backup is recorded in your activity.</p>
        {canExport ? <a className="btn secondary" href="/api/data/export?format=backup">Download backup (ZIP)</a> : <p className="muted">Backups are for the owner and the accountant.</p>}
      </section>

      <section className="panel" aria-label="Export to Tally">
        <h2>Export to Tally</h2>
        <p className="muted">Sales, credit notes and receipts as a Tally import file, with the ledgers they use. Try it in a test company first, and ask your accountant to check the ledger names. Cancelled invoices, and payments with no customer, are left out.</p>
        {!canExport ? <p className="muted">Exports are for the owner and the accountant.</p> : (
          <>
            <div className="row">
              <div><label htmlFor="tf">From</label><input id="tf" type="date" value={tf} onChange={(e) => setTf(e.target.value)} /></div>
              <div><label htmlFor="tt">To</label><input id="tt" type="date" value={tt} onChange={(e) => setTt(e.target.value)} /></div>
            </div>
            <details style={{ margin: '12px 0' }}>
              <summary>Ledger names</summary>
              <div className="row" style={{ marginTop: 8 }}>
                {LEDGERS.map(([k, label, def]) => (
                  <div key={k}><label htmlFor={`l-${k}`}>{label}</label><input id={`l-${k}`} placeholder={def} value={ledgers[k]} onChange={(e) => setLedgers({ ...ledgers, [k]: e.target.value })} /></div>))}
              </div>
            </details>
            <a className="btn secondary" href={tally}>Download Tally file</a>
          </>)}
      </section>

      <section className="panel" aria-label="Import">
        <h2>Import from a spreadsheet</h2>
        {!canImport ? <p className="muted">Importing is for the owner and staff.</p> : (
          <>
            <p className="muted">Save your sheet as CSV (in Excel: File, Save As, CSV). The first row must name the columns. Rows that already exist are skipped, so it is safe to try again.</p>
            <div className="row">
              <div><label htmlFor="ik">What are you importing?</label>
                <select id="ik" value={kind} onChange={(e) => { setKind(e.target.value as 'customers' | 'items'); setPreview(null); setResult(null); setCsv(''); setFileName(''); setErr(''); }}>
                  <option value="customers">Customers</option><option value="items">Items</option></select></div>
              <div><label htmlFor="if">CSV file</label><input id="if" type="file" accept=".csv,text/csv" onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)} /></div>
            </div>
            <p><a href={template} download={`kora_${kind}_template.csv`}>Download a template</a></p>
            {err && <p className="error" role="alert">{err}</p>}
            {busy && <p className="muted" role="status">Working</p>}
            {preview && (
              <div data-testid="import-preview">
                <p><b>{fileName}</b>: <span data-testid="count-ok">{preview.counts.ok}</span> to add, <span data-testid="count-dup">{preview.counts.duplicate}</span> already in Kora, <span data-testid="count-err">{preview.counts.error}</span> with a problem.
                  {preview.columns.ignored.length > 0 && <span className="muted"> Ignored columns: {preview.columns.ignored.join(', ')}.</span>}</p>
                {shown.length > 0 && (
                  <table className="t"><thead><tr><th>Row</th><th>Name</th><th>What will happen</th></tr></thead>
                    <tbody>{shown.map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td>{r.status === 'error' ? <span className="error">{r.message}</span> : <span className="muted">{r.message}</span>}</td></tr>)}</tbody></table>)}
                {preview.counts.ok > 0
                  ? <button disabled={busy} onClick={() => void doImport()}>Import {preview.counts.ok} {kind === 'customers' ? 'customer' : 'item'}{preview.counts.ok === 1 ? '' : 's'}</button>
                  : <p className="muted">There is nothing new to import.</p>}
                {preview.counts.error > 0 && preview.counts.ok > 0 && <p className="muted">Rows with a problem are left out. Fix them in your sheet and import the file again.</p>}
              </div>)}
            {result && (
              <div className="ok" role="status" data-testid="import-result">
                <p>Done. <b>{result.created}</b> added, {result.skipped} already there, {result.failed} left out.</p>
                {result.problems.length > 0 && <ul>{result.problems.slice(0, 20).map((p) => <li key={p.line}>Row {p.line} ({p.name || 'no name'}): {p.message}</li>)}</ul>}
              </div>)}
          </>)}
      </section>
    </>
  );
}
