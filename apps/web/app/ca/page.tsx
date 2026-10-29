'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import KoraLoader from '../../components/KoraLoader';
import Requests from './requests';
import { api } from '../../lib/client';

type Member = { userId: string; email: string; role: string };
type Row = {
  id: string; clientName: string; gstin: string; form: string; period: string; statutoryDeadline: string | null; deadlineSource: string; internalTarget: string | null;
  status: 'open' | 'preparing' | 'in_review' | 'done'; ownerId: string | null; reviewerId: string | null;
  blocker: { reason: string; party: string; nextAction: string; expected: string | null; since: string } | null;
};
type List = { total: number; limit: number; engagements: Row[] };
type Me = { you: string; role: string; members: Member[] };

const STATUS: Record<Row['status'], string> = { open: 'Not started', preparing: 'Preparing', in_review: 'In review', done: 'Done' };
const PARTY: Record<string, string> = { client: 'the client', firm: 'us', third_party: 'someone else' };
const today = () => new Date().toISOString().slice(0, 10);
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));

/** The firm's work list: one row per form per client for the month, with who has it, where it stands, and what is holding it up. */
export default function Work() {
  const [me, setMe] = useState<Me | null>(null);
  const [list, setList] = useState<List | null>(null);
  const [period, setPeriod] = useState(prevMonth());
  const [view, setView] = useState<'all' | 'mine' | 'blocked'>('all');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const [bl, setBl] = useState({ reason: '', party: 'client', nextAction: '', expected: '' });

  const load = useCallback(async () => {
    const q = new URLSearchParams({ period, limit: '200' });
    if (view === 'mine') q.set('mine', '1');
    if (view === 'blocked') q.set('blocked', '1');
    const [m, l] = await Promise.all([api<Me>('/api/ca/firm'), api<List>(`/api/ca/engagements?${q}`)]);
    setMe(m); setList(l);
  }, [period, view]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setNote(''); try { await fn(); await load(); if (ok) setNote(ok); } catch (e) { setErr((e as Error).message); } };
  const patch = (id: string, body: object) => run(() => api(`/api/ca/engagements/${id}`, { method: 'PATCH', body }));
  const wide = me?.role === 'partner' || me?.role === 'manager';
  const name = useMemo(() => new Map((me?.members ?? []).map((m) => [m.userId, m.email])), [me]);

  if (!me || !list) return err ? <p className="error" role="alert">{err}</p> : <KoraLoader />;
  const rows = list.engagements;
  const blocked = rows.filter((r) => r.blocker).length;
  const dueSoon = rows.filter((r) => r.status !== 'done' && r.statutoryDeadline && r.statutoryDeadline >= today() && r.statutoryDeadline <= new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)).length;
  const passed = rows.filter((r) => r.status !== 'done' && r.statutoryDeadline && r.statutoryDeadline < today()).length;

  return (
    <>
      <div className="toolbar">
        <div><h1>Work</h1><p className="page-sub">GST returns to prepare for each client, who has them and what is holding them up.</p></div>
        {wide && <button className="secondary" onClick={() => run(async () => { const r = await api('/api/ca/reminders', { body: {} }); setNote(`${r.queued} reminder(s) queued, ${r.cancelled} cancelled. ${r.summary.queued} waiting, ${r.summary.sent} sent, ${r.summary.failed} failed. Kora does not send them yet: copy the client link and send it yourself.`); })}>Queue reminders</button>}
        {wide && <button className="btn" onClick={() => run(async () => { const r = await api('/api/ca/engagements/generate', { body: { period } }); setNote(`${period}: ${r.created} added, ${r.existing} already there.`); })}>Create {period} work</button>}
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Shown</div><div className="value">{list.total}</div></div>
        <div className="stat"><div className="label">Due in 5 days</div><div className="value" data-testid="ca-due">{dueSoon}</div></div>
        <div className="stat"><div className="label">Date passed, not done</div><div className="value" data-testid="ca-passed">{passed}</div></div>
        <div className="stat"><div className="label">Blocked</div><div className="value" data-testid="ca-blocked">{blocked}</div></div>
      </div>

      <div className="filters">
        <div><label htmlFor="cp">Month worked on</label><input id="cp" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></div>
        <div><label htmlFor="cv">Show</label>
          <select id="cv" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
            <option value="all">All work</option><option value="mine">My work</option><option value="blocked">Blocked</option>
          </select></div>
      </div>

      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}
      {list.total > list.engagements.length && <p className="error" role="alert">Showing {list.engagements.length} of {list.total}. Narrow the month or filter.</p>}

      {rows.length === 0 ? (
        <div className="panel empty"><h3>No work for {period}</h3><p>{wide ? 'Press “Create ' + period + ' work” to add GSTR-1 and GSTR-3B for every client.' : 'Nothing is assigned to you for this month.'}</p></div>
      ) : (
        <div style={{ overflowX: 'auto' }}><table className="t" aria-label="Work">
          <thead><tr><th>Client</th><th>Form</th><th>Due</th><th>Status</th><th>Preparer</th><th>Reviewer</th><th>Held up</th></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.id}><tr>
              <td><b>{r.clientName}</b><br /><span className="muted">{r.gstin}</span><br /><button className="link" aria-expanded={docs === r.id} onClick={() => setDocs(docs === r.id ? null : r.id)}>Documents</button></td>
              <td>{r.form}</td>
              <td>{r.statutoryDeadline ?? (<><span className="chip cancelled" title={r.deadlineSource}>no date yet</span><br />
                <input type="date" aria-label={`Set the due date of ${r.form} for ${r.clientName}`} onChange={(e) => e.target.value && patch(r.id, { statutoryDeadline: e.target.value, deadlineSource: 'Set by hand' })} /></>)}
                {r.statutoryDeadline && r.status !== 'done' && r.statutoryDeadline < today() && <><br /><span className="chip" title="Kora does not know whether this was filed">date passed</span></>}
                {r.internalTarget && <><br /><span className="muted">aim {r.internalTarget}</span></>}</td>
              <td><select style={{ minWidth: 120 }} aria-label={`Status of ${r.form} for ${r.clientName}`} value={r.status} onChange={(e) => patch(r.id, { status: e.target.value })}>
                {(Object.keys(STATUS) as Row['status'][]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select></td>
              <td>{wide ? (
                <select style={{ minWidth: 140 }} aria-label={`Preparer for ${r.form} for ${r.clientName}`} value={r.ownerId ?? ''} onChange={(e) => patch(r.id, { ownerId: e.target.value || null })}>
                  <option value="">Nobody</option>{me.members.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}</select>) : (name.get(r.ownerId ?? '') ?? <span className="muted">Nobody</span>)}</td>
              <td>{wide ? (
                <select style={{ minWidth: 140 }} aria-label={`Reviewer for ${r.form} for ${r.clientName}`} value={r.reviewerId ?? ''} onChange={(e) => patch(r.id, { reviewerId: e.target.value || null })}>
                  <option value="">Nobody</option>{me.members.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}</select>) : (name.get(r.reviewerId ?? '') ?? <span className="muted">Nobody</span>)}</td>
              <td>{r.blocker ? (
                <><span className="chip cancelled">Waiting on {PARTY[r.blocker.party]}</span> {r.blocker.reason}
                  <br /><span className="muted">{ageDays(r.blocker.since)} day(s){r.blocker.expected ? `, expected ${r.blocker.expected}` : ''}{r.blocker.nextAction ? ` · next: ${r.blocker.nextAction}` : ''}</span>
                  <br /><button className="link" onClick={() => patch(r.id, { blocker: null })}>Clear</button> <button className="link" onClick={() => { setBl({ reason: r.blocker!.reason, party: r.blocker!.party, nextAction: r.blocker!.nextAction, expected: r.blocker!.expected ?? '' }); setEditing(r.id); }}>Edit</button></>
              ) : <button className="link" onClick={() => { setBl({ reason: '', party: 'client', nextAction: '', expected: '' }); setEditing(r.id); }}>Add</button>}</td>
            </tr>
            {docs === r.id && <tr><td colSpan={7}><Requests engagementId={r.id} onChange={() => { void load(); }} /></td></tr>}
            {editing === r.id && <tr><td colSpan={7}><form className="filters" onSubmit={(e) => { e.preventDefault(); void patch(r.id, { blocker: { reason: bl.reason, party: bl.party, nextAction: bl.nextAction, expected: bl.expected || null } }).then(() => setEditing(null)); }}>
                <div style={{ flex: 3 }}><label htmlFor={`br${r.id}`}>What is holding it up</label><input id={`br${r.id}`} placeholder="What is missing?" value={bl.reason} onChange={(e) => setBl({ ...bl, reason: e.target.value })} required maxLength={500} /></div>
                <div><label htmlFor={`bp${r.id}`}>Waiting on</label><select id={`bp${r.id}`} value={bl.party} onChange={(e) => setBl({ ...bl, party: e.target.value })}><option value="client">The client</option><option value="firm">Us</option><option value="third_party">Someone else</option></select></div>
                <div style={{ flex: 2 }}><label htmlFor={`bn${r.id}`}>Next step</label><input id={`bn${r.id}`} value={bl.nextAction} onChange={(e) => setBl({ ...bl, nextAction: e.target.value })} maxLength={500} /></div>
                <div><label htmlFor={`be${r.id}`}>Expected by</label><input id={`be${r.id}`} type="date" value={bl.expected} onChange={(e) => setBl({ ...bl, expected: e.target.value })} /></div>
                <button className="btn">Save</button> <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
              </form></td></tr>}</Fragment>))}</tbody>
        </table></div>
      )}
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Due dates are the standard monthly ones (GSTR-1 on the 11th, GSTR-3B on the 20th of the next month). Quarterly filers have no date until you set it, and extensions are not tracked. Kora does not file returns or know whether one was filed.</p>
    </>
  );
}
