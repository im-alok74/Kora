'use client';
import { useState } from 'react';
import { api } from '../lib/client';

type PreviewRow = { line: number; status: 'ok' | 'duplicate' | 'error'; message: string | null; name: string };
type Preview = { kind: string; columns: { mapped: string[]; ignored: string[] }; counts: { total: number; ok: number; duplicate: number; error: number }; rows: PreviewRow[] };
type Result = { created: number; skipped: number; failed: number; problems: { line: number; name: string; message: string }[] };

const TEMPLATES: Record<string, string> = {
  customers: 'Name,GSTIN,State,Mobile,Email,Address,City,Pincode,Currency\r\nAsha Stores,,Maharashtra,9876543210,asha@example.com,12 Main Road,Pune,411001,INR\r\n',
  items: 'Name,Type,HSN or SAC,Unit,GST percent,Price\r\nWidget,Goods,8471,NOS,18,250.00\r\nConsulting,Service,998313,HRS,18,2000.00\r\n',
};

/**
 * Customers and items from a CSV, Excel or Tally file, using the same importer as the Data page: a preview first, then confirm.
 * Rows that already exist are skipped, so it is safe to try again.
 */
export default function ListImport({ allowTally = true }: { allowTally?: boolean }) {
  const [kind, setKind] = useState<'customers' | 'items'>('customers');
  const [payload, setPayload] = useState<Record<string, string> | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = () => { setPreview(null); setResult(null); setPayload(null); setFileName(''); setErr(''); };

  const chooseFile = async (f: File | null) => {
    reset();
    if (!f) return;
    const lower = f.name.toLowerCase();
    const xlsx = lower.endsWith('.xlsx'), tally = lower.endsWith('.xml');
    if (tally && !allowTally) { setErr('This step takes a CSV or Excel file.'); return; }
    if (f.size > (xlsx ? 10_000_000 : tally ? 5_000_000 : 1_000_000)) { setErr(xlsx ? 'The Excel file is larger than 10 MB. Split it into smaller files.' : tally ? 'The Tally file is larger than 5 MB. Export only the ledgers you need.' : 'The file is larger than 1 MB. Split it into smaller files.'); return; }
    let body: Record<string, string>;
    if (xlsx) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      body = { xlsx: btoa(bin) };
    } else body = tally ? { tally: await f.text() } : { csv: await f.text() };
    setPayload(body); setFileName(f.name); setBusy(true);
    try { setPreview((await api('/api/data/import', { body: { kind, ...body } })).preview); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const doImport = async () => {
    setBusy(true); setErr('');
    try { setResult((await api('/api/data/import', { body: { kind, ...payload, commit: true } })).result); setPreview(null); setPayload(null); setFileName(''); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + TEMPLATES[kind])}`;
  const shown = preview ? preview.rows.filter((r) => r.status !== 'ok').slice(0, 100) : [];

  return (
    <div>
      <div className="row">
        <div><label htmlFor="lk">What are you importing?</label>
          <select id="lk" value={kind} onChange={(e) => { setKind(e.target.value as 'customers' | 'items'); reset(); }}><option value="customers">Customers</option><option value="items">Items</option></select></div>
        <div><label htmlFor="lf">File</label><input id="lf" type="file" accept={allowTally ? '.csv,text/csv,.xlsx,.xml' : '.csv,text/csv,.xlsx'} onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)} /></div>
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
    </div>
  );
}
