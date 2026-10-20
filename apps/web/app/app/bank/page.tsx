'use client';
import { useEffect, useState } from 'react';
import { api, rupees } from '../../../lib/client';

type Sugg = { kind: 'invoice' | 'bill'; id: string; label: string; party: string; duePaise: string; score: number; reasons: string[] };
type Row = { index: number; date: string | null; description: string; reference: string; creditPaise: string; debitPaise: string; fingerprint: string; alreadyRecorded: boolean; suggestions: Sugg[] };
type Preview = { skipped: number; problems: string[]; rows: Row[] };

/** Upload a bank statement, check the suggested matches, and record the ones you confirm as payments. */
export default function Bank() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [p, setP] = useState<Preview | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});     // row index -> suggestion id, or '' for none
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api('/api/business').then((b) => setRole(b.role)).catch(() => {}); }, []);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setMsg(''); setP(null); setFileName(f.name);
    const text = await f.text();
    setCsv(text);
    setBusy(true);
    try {
      const r: Preview = await api('/api/bank/preview', { body: { csv: text } });
      setP(r);
      // Suggestions backed by more than the amount are chosen for you; an amount alone you confirm yourself.
      const chosen: Record<number, string> = {};
      for (const row of r.rows) { const s = row.suggestions[0]; if (s && s.score >= 85) chosen[row.index] = s.id; }
      setPick(chosen);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const canWrite = role === 'owner' || role === 'staff';
  const chosenRows = (p?.rows ?? []).filter((r) => pick[r.index]);
  const total = chosenRows.reduce((a, r) => a + BigInt(r.creditPaise) + BigInt(r.debitPaise), 0n);

  const record = async () => {
    if (!p) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const items = chosenRows.map((r) => {
        const s = r.suggestions.find((x) => x.id === pick[r.index])!;
        const paise = BigInt(r.creditPaise) > 0n ? BigInt(r.creditPaise) : BigInt(r.debitPaise);
        return { kind: s.kind, id: s.id, amount: `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`, date: r.date!, description: r.description, fingerprint: r.fingerprint };
      });
      const res = await api('/api/bank/apply', { body: { items } });
      setMsg(`${res.done} recorded${res.failed ? `, ${res.failed} could not be recorded: ${res.results.find((x: { ok: boolean; error?: string }) => !x.ok)?.error ?? ''}` : ''}.`);
      setP(await api('/api/bank/preview', { body: { csv } }));
      setPick({});
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="toolbar"><div><h1>Bank statement</h1><p className="page-sub">Upload the CSV from net banking. Kora suggests which invoice or bill each line settles. Nothing is recorded until you confirm.</p></div></div>
      <div className="panel">
        <label htmlFor="bf" style={{ marginTop: 0 }}>Statement file (CSV)</label>
        <input id="bf" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void read(e.target.files?.[0])} />
        <p className="muted">Most banks offer this under Account statement, then Download as CSV or Excel (save the Excel file as CSV). The file stays in this browser until you confirm lines.</p>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {busy && !p && <p className="muted" role="status">Reading the statement</p>}
      {p && p.problems.length > 0 && <p className="error" role="alert">{p.problems.join(' ')}</p>}
      {p && p.rows.length > 0 && (
        <>
          <p className="muted" data-testid="bank-summary">{fileName}: {p.rows.length} lines read{p.skipped ? `, ${p.skipped} skipped (no date or amount)` : ''}. {p.rows.filter((r) => r.suggestions.length > 0).length} have a suggested match.</p>
          <table className="t" aria-label="Statement lines">
            <thead><tr><th>Date</th><th>Narration</th><th className="n">In</th><th className="n">Out</th><th>Settles</th></tr></thead>
            <tbody>{p.rows.map((r) => (
              <tr key={r.index}>
                <td>{r.date}</td><td>{r.description}{r.reference ? <span className="muted"> · {r.reference}</span> : null}</td>
                <td className="n">{BigInt(r.creditPaise) > 0n ? rupees(r.creditPaise) : ''}</td><td className="n">{BigInt(r.debitPaise) > 0n ? rupees(r.debitPaise) : ''}</td>
                <td>{r.alreadyRecorded ? <span className="chip paid">Already recorded</span> : r.suggestions.length === 0 ? <span className="muted">No match</span> : (
                  <select aria-label={`Match for line ${r.index + 1}`} value={pick[r.index] ?? ''} disabled={!canWrite} onChange={(e) => setPick({ ...pick, [r.index]: e.target.value })}>
                    <option value="">Do not record</option>
                    {r.suggestions.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.party} · {s.reasons[0]}</option>)}
                  </select>)}</td>
              </tr>))}</tbody>
          </table>
          {canWrite ? (
            <div className="bulkbar" role="region" aria-label="Record the chosen lines">
              <b data-testid="bank-chosen">{chosenRows.length} chosen, {rupees(total)}</b>
              <button disabled={busy || chosenRows.length === 0} onClick={() => void record()}>Record {chosenRows.length} payment{chosenRows.length === 1 ? '' : 's'}</button>
            </div>) : <p className="muted">Your role can read the statement but not record payments.</p>}
        </>)}
    </>
  );
}
