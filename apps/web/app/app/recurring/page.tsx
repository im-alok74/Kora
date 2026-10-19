'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, TAX_RATES } from '../../../lib/client';

type Row = { id: string; name: string; doc_type: string; every_n: number; unit: string; start_date: string; end_date: string | null; next_run_date: string;
  mode: string; channel: string | null; active: boolean; party_id: string; party_name: string; created: number; failed: number };
type Run = { id: string; run_date: string; status: string; note: string | null; document_id: string | null; number: string | null; document_status: string | null };
type Line = { name: string; hsnSac: string; quantity: string; rate: string; taxRateBp: number };
type Party = { id: string; name: string };

const UNIT: Record<string, [string, string]> = { week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };
const MODE: Record<string, string> = { draft: 'Save as a draft', issue: 'Issue automatically', issue_and_send: 'Issue and send' };
const every = (n: number, u: string) => (n === 1 ? `Every ${UNIT[u]![0]}` : `Every ${n} ${UNIT[u]![1]}`);
const blankLine = (): Line => ({ name: '', hsnSac: '', quantity: '1', rate: '', taxRateBp: 1800 });
const today = () => new Date().toLocaleDateString('en-CA');
const BLANK = { name: '', partyId: '', unit: 'month', everyN: 1, startDate: today(), endDate: '', mode: 'draft', channel: 'whatsapp', termsDays: 15, notes: '' };

export default function Recurring() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [role, setRole] = useState('');
  const [form, setForm] = useState(BLANK);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [open, setOpen] = useState(false);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const canWrite = role === 'owner' || role === 'staff';

  const load = useCallback(async () => { setRows((await api('/api/recurring')).recurring); }, []);
  useEffect(() => {
    void load().catch((e) => setErr(e.message));
    api('/api/parties').then((r) => setParties(r.parties));
    api('/api/business').then((b) => setRole(b.role));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setMsg(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const showRuns = async (id: string) => {
    if (openRuns === id) { setOpenRuns(null); return; }
    setRuns((await api(`/api/recurring/${id}`)).runs); setOpenRuns(id);
  };

  const create = () => run(async () => {
    await api('/api/recurring', { body: {
      name: form.name, partyId: form.partyId, unit: form.unit, everyN: Number(form.everyN), startDate: form.startDate, endDate: form.endDate || null,
      mode: form.mode, channel: form.mode === 'issue_and_send' ? form.channel : null, termsDays: Number(form.termsDays), notes: form.notes || null,
      lines: lines.filter((l) => l.name.trim() || l.rate).map((l) => ({ name: l.name, hsnSac: l.hsnSac || null, quantity: l.quantity || '0', rate: l.rate || '0', taxRateBp: l.taxRateBp })),
    } });
    setForm(BLANK); setLines([blankLine()]); setOpen(false); await load(); setMsg('Recurring invoice saved.');
  });

  return (
    <>
      <div className="toolbar">
        <h1>Recurring invoices</h1>
        {canWrite && !open && <button onClick={() => setOpen(true)}>New recurring invoice</button>}
      </div>
      <p className="muted">Invoice a customer on a schedule: weekly, monthly or yearly. Kora makes each invoice on its date, as a draft for you to check, or issued and sent for you.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      {open && canWrite && (
        <form className="panel" aria-label="New recurring invoice" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <h2>New recurring invoice</h2>
          <div className="row">
            <div><label htmlFor="rn">Name</label><input id="rn" placeholder="Monthly retainer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label htmlFor="rp">Customer</label>
              <select id="rp" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })} required>
                <option value="">Choose a customer</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </div>
          <div className="row">
            <div><label htmlFor="re">Repeat every</label><input id="re" type="number" min={1} max={24} value={form.everyN} onChange={(e) => setForm({ ...form, everyN: Number(e.target.value) })} /></div>
            <div><label htmlFor="ru">Period</label>
              <select id="ru" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></select></div>
            <div><label htmlFor="rs">First invoice on</label><input id="rs" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></div>
            <div><label htmlFor="rx">Stop after (optional)</label><input id="rx" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="rm">On each date</label>
              <select id="rm" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {form.mode === 'issue_and_send' && (
              <div><label htmlFor="rc">Send by</label>
                <select id="rc" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></div>)}
            <div><label htmlFor="rt">Payment due after (days)</label><input id="rt" type="number" min={0} max={365} value={form.termsDays} onChange={(e) => setForm({ ...form, termsDays: Number(e.target.value) })} /></div>
          </div>

          <h3 style={{ marginTop: 16 }}>What to invoice</h3>
          <table className="t"><thead><tr><th>Description</th><th>HSN or SAC</th><th>Qty</th><th>Rate (Rs)</th><th>GST</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td><input aria-label={`Line ${i + 1} description`} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                <td><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(i, { taxRateBp: Number(e.target.value) })}>
                  {TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td>{lines.length > 1 && <button type="button" className="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>))}</tbody></table>
          <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add a line</button>
          <label htmlFor="rno">Notes on each invoice (optional)</label>
          <textarea id="rno" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button disabled={busy}>Save recurring invoice</button>
            <button type="button" className="secondary" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          </div>
        </form>)}

      {rows && rows.length === 0 && !open && (
        <div className="panel"><p>No recurring invoices yet. Set one up for a customer you bill every week, month or year.</p></div>)}
      {rows && rows.length > 0 && (
        <table className="t">
          <thead><tr><th>Name</th><th>Customer</th><th>Repeats</th><th>Next invoice</th><th>On each date</th><th className="n">Made</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.name} {!r.active && <span className="chip cancelled">{r.end_date && r.next_run_date > r.end_date ? 'Finished' : 'Paused'}</span>}</td>
                <td>{r.party_name}</td>
                <td>{every(r.every_n, r.unit)}</td>
                <td>{r.active ? r.next_run_date : ''}</td>
                <td>{MODE[r.mode]}{r.mode === 'issue_and_send' ? ` by ${r.channel}` : ''}</td>
                <td className="n">{r.created}{r.failed > 0 && <span className="error"> ({r.failed} failed)</span>}</td>
                <td className="n">
                  <button className="link" onClick={() => void showRuns(r.id)}>{openRuns === r.id ? 'Hide history' : 'History'}</button>
                  {canWrite && (<>{' '}
                    <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/recurring/${r.id}/active`, { body: { active: !r.active } }); await load(); })}>{r.active ? 'Pause' : 'Resume'}</button>{' '}
                    <button className="link" disabled={busy} onClick={() => { if (confirm(`Delete "${r.name}"? Invoices already made are kept.`)) void run(async () => { await api(`/api/recurring/${r.id}`, { method: 'DELETE' }); await load(); }); }}>Delete</button></>)}
                </td>
              </tr>
              {openRuns === r.id && (
                <tr><td colSpan={7}>
                  {runs.length === 0 ? <span className="muted">Nothing made yet. The first invoice is made on {r.next_run_date}.</span> : (
                    <table className="t"><thead><tr><th>Date</th><th>Result</th><th>Document</th></tr></thead>
                      <tbody>{runs.map((x) => (
                        <tr key={x.id}><td>{x.run_date}</td>
                          <td>{x.status === 'failed' ? <span className="error">Could not make it: {x.note}</span> : <>Made{x.note ? `. ${x.note}` : ''}</>}</td>
                          <td>{x.document_id ? <a href={`/app/invoices/${x.document_id}`}>{x.number ?? 'Draft'}</a> : ''}</td></tr>))}</tbody></table>)}
                </td></tr>)}
            </Fragment>))}</tbody>
        </table>)}
    </>
  );
}
