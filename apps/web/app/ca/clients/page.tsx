'use client';
import { useCallback, useEffect, useState } from 'react';
import KoraLoader from '../../../components/KoraLoader';
import { api } from '../../../lib/client';
import ClientLink from '../client-link';

type Member = { userId: string; email: string; role: string; pending?: boolean };
type Client = { id: string; legalName: string; pan: string | null; sourceSoftware: string; registrations: { id: string; gstin: string; registrationType: string; filingFrequency: string }[] };
type List = { total: number; limit: number; clients: Client[] };
type Preview = { lines: { line: number; legalName: string; gstin: string; status: 'new' | 'exists' | 'error'; message: string }[]; counts: { new: number; exists: number; error: number } };
type Me = { you: string; role: string; members: Member[] };

const TEMPLATE = 'legal_name,gstin,pan,source_software,filing_frequency\n';

export default function Clients() {
  const [me, setMe] = useState<Me | null>(null);
  const [list, setList] = useState<List | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [f, setF] = useState({ legalName: '', gstin: '', pan: '', sourceSoftware: '', filingFrequency: 'monthly' });
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [assignees, setAssignees] = useState<Record<string, { userId: string; email: string }[]>>({});

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([api<Me>('/api/ca/firm'), api<List>('/api/ca/clients?limit=200')]);
    setMe(m); setList(l);
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const wide = me?.role === 'partner' || me?.role === 'manager';
  const run = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setNote(''); try { await fn(); await load(); if (ok) setNote(ok); } catch (e) { setErr((e as Error).message); } };

  const add = (e: React.FormEvent) => { e.preventDefault(); void run(async () => {
    await api('/api/ca/clients', { body: { legalName: f.legalName, pan: f.pan || undefined, sourceSoftware: f.sourceSoftware, registrations: [{ gstin: f.gstin, filingFrequency: f.filingFrequency }] } });
    setF({ legalName: '', gstin: '', pan: '', sourceSoftware: '', filingFrequency: 'monthly' });
  }, 'Client added.'); };

  const onFile = async (file: File | undefined) => { if (file) { setCsv(await file.text()); setPreview(null); } };
  const check = () => run(async () => { setPreview(await api<Preview>('/api/ca/clients/import', { body: { csv } })); });
  const commit = () => run(async () => { const r = await api('/api/ca/clients/import', { body: { csv, commit: true } }); setNote(`${r.added} client(s) added, ${r.skipped} row(s) skipped because they already exist.`); setPreview(null); setCsv(''); });
  const showAssignees = async (id: string) => { const r = await api<{ assignees: { userId: string; email: string }[] }>(`/api/ca/clients/${id}/assignees`); setAssignees((a) => ({ ...a, [id]: r.assignees })); };

  if (!me || !list) return err ? <p className="error" role="alert">{err}</p> : <KoraLoader />;
  const rows = list.clients.filter((c) => (c.legalName + ' ' + c.registrations.map((r) => r.gstin).join(' ')).toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="toolbar"><div><h1>Clients</h1><p className="page-sub">{wide ? 'Every client of the firm.' : 'The clients assigned to you.'}</p></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}
      {list.total > list.clients.length && <p className="error" role="alert">Showing {list.clients.length} of {list.total} clients.</p>}

      {wide && (
        <div className="panel">
          <h2>Add a client</h2>
          <p className="muted">A client does not need to use Kora. Add each GST registration; add another registration later by importing a file.</p>
          <form onSubmit={add} className="filters">
            <div style={{ flex: 2 }}><label htmlFor="cn">Client name</label><input id="cn" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} required maxLength={200} /></div>
            <div style={{ flex: 2 }}><label htmlFor="cg">GSTIN</label><input id="cg" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} required maxLength={15} /></div>
            <div><label htmlFor="cpan">PAN (optional)</label><input id="cpan" value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} maxLength={10} /></div>
            <div><label htmlFor="cs">Their books are in</label><input id="cs" placeholder="Tally, Excel…" value={f.sourceSoftware} onChange={(e) => setF({ ...f, sourceSoftware: e.target.value })} maxLength={60} /></div>
            <div><label htmlFor="cf">Files</label><select id="cf" value={f.filingFrequency} onChange={(e) => setF({ ...f, filingFrequency: e.target.value })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly (QRMP)</option></select></div>
            <button className="btn">Add client</button>
          </form>

          <h2 style={{ marginTop: 24 }}>Import from a file</h2>
          <p className="muted">A CSV with the columns <code>legal_name, gstin</code> and optionally <code>pan, source_software, filing_frequency, registration_type</code>. Rows with the same name become one client with several GSTINs. Up to 500 rows. Nothing is added if any row has a problem.</p>
          <p><a download="clients-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a></p>
          <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
          {csv && <p><button className="secondary" onClick={check}>Check the file</button></p>}
          {preview && (
            <>
              <p role="status"><b>{preview.counts.new}</b> new row(s), <b>{preview.counts.exists}</b> already added, <b className={preview.counts.error ? 'error' : undefined}>{preview.counts.error}</b> with problems.</p>
              {preview.counts.error > 0 && (
                <table className="t" aria-label="Problems"><thead><tr><th>Row</th><th>Client</th><th>GSTIN</th><th>Problem</th></tr></thead>
                  <tbody>{preview.lines.filter((l) => l.status === 'error').map((l) => <tr key={l.line}><td>{l.line}</td><td>{l.legalName}</td><td>{l.gstin}</td><td>{l.message}</td></tr>)}</tbody></table>
              )}
              <p><button className="btn" disabled={preview.counts.error > 0 || preview.counts.new === 0} onClick={commit}>Add {preview.counts.new} row(s)</button></p>
            </>
          )}
        </div>
      )}

      <div className="filters"><div style={{ flex: 2 }}><label htmlFor="cq">Search</label><input id="cq" type="search" placeholder="Name or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>

      {rows.length === 0 ? (
        <div className="panel empty"><h3>No clients {q ? 'match' : 'yet'}</h3><p>{wide ? 'Add one above, or import a file.' : 'Ask a partner to assign clients to you.'}</p></div>
      ) : (
        <table className="t ca-table" aria-label="Clients">
          <thead><tr><th>Client</th><th>GSTINs</th><th>Books in</th><th>Their Kora books</th>{wide && <th>Looked after by</th>}</tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}>
              <td data-label="Client"><b>{c.legalName}</b>{c.pan && <><br /><span className="muted">{c.pan}</span></>}</td>
              <td data-label="GSTINs">{c.registrations.map((r) => <div key={r.id} style={{ fontSize: 13 }}>{r.gstin} <span className="muted">{r.filingFrequency}{r.registrationType !== 'regular' ? `, ${r.registrationType}` : ''}</span></div>)}</td>
              <td data-label="Books in">{c.sourceSoftware || <span className="muted">Not said</span>}</td>
              <td data-label="Their Kora books"><ClientLink clientId={c.id} wide={!!wide} /></td>
              {wide && <td data-label="Looked after by">
                {assignees[c.id] ? (assignees[c.id]!.length ? assignees[c.id]!.map((a) => (
                  <div key={a.userId}>{a.email} <button className="link" onClick={() => run(async () => { await api(`/api/ca/clients/${c.id}/assignees?userId=${a.userId}`, { method: 'DELETE' }); await showAssignees(c.id); })}>Remove</button></div>
                )) : <span className="muted">Only partners and managers</span>) : <button className="link" onClick={() => showAssignees(c.id).catch((e) => setErr(e.message))}>Show</button>}
                <select aria-label={`Give ${c.legalName} to`} value="" onChange={(e) => e.target.value && run(async () => { await api(`/api/ca/clients/${c.id}/assignees`, { body: { userId: e.target.value } }); await showAssignees(c.id); })}>
                  <option value="">Give to…</option>{me.members.filter((m) => !m.pending && (m.role === 'preparer' || m.role === 'reviewer')).map((m) => <option key={m.userId} value={m.userId}>{m.email} ({m.role})</option>)}</select>
              </td>}
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
