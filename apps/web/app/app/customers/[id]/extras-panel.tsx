'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, paiseToRupeeText, rupees } from '../../../../lib/client';

type Extras = {
  tags: string[]; credit_limit_paise: string | null; opening_balance_paise: string; opening_balance_on: string | null;
  credit: { limitPaise: string | null; owedPaise: string; availablePaise: string | null; over: boolean };
};
type Note = { id: string; body: string; createdAt: string; author: string; mine: boolean };
const toRupees = (p: string | null) => (p === null ? '' : paiseToRupeeText(p));

/** Labels, the most this customer may owe, what they owed before Kora, and the team's notes. */
export default function ExtrasPanel({ partyId, canWrite, isOwner }: { partyId: string; canWrite: boolean; isOwner: boolean }) {
  const [x, setX] = useState<Extras | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState('');
  const [limit, setLimit] = useState('');
  const [opening, setOpening] = useState('');
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const e: Extras = await api(`/api/parties/${partyId}/extras`);
    setX(e); setTags(e.tags.join(', ')); setLimit(toRupees(e.credit_limit_paise)); setOpening(BigInt(e.opening_balance_paise) === 0n ? '' : toRupees(e.opening_balance_paise)); setOn(e.opening_balance_on ?? '');
    setNotes((await api(`/api/parties/${partyId}/notes`)).notes);
  }, [partyId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (fn: () => Promise<void>, done?: string) => { setErr(''); setMsg(''); try { await fn(); await load(); if (done) setMsg(done); } catch (e) { setErr((e as Error).message); } };

  if (!x) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  const c = x.credit;
  return (
    <>
      <form className="panel" aria-label="Tags, credit limit and opening balance" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => { await api(`/api/parties/${partyId}/extras`, { method: 'PUT', body: { tags: tags.split(',').map((t) => t.trim()).filter(Boolean), creditLimit: limit, openingBalance: opening, openingBalanceOn: on || null } }); }, 'Saved.');
      }}>
        <h2>Tags, credit limit and opening balance</h2>
        {c.over && <p className="error" role="alert" data-testid="over-limit">Over the credit limit by {rupees((BigInt(c.owedPaise) - BigInt(c.limitPaise!)).toString())}.</p>}
        {c.limitPaise !== null && !c.over && <p className="ok">Within the limit: {rupees(c.owedPaise)} owed, {rupees(c.availablePaise)} to go.</p>}
        <label htmlFor="xt">Tags (separate with commas)</label>
        <input id="xt" value={tags} disabled={!canWrite} placeholder="wholesale, slow-payer" onChange={(e) => setTags(e.target.value)} />
        <div className="row">
          <div><label htmlFor="xl">Credit limit (Rs)</label><input id="xl" inputMode="decimal" disabled={!canWrite} value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
          <div><label htmlFor="xo">Opening balance (Rs)</label><input id="xo" inputMode="decimal" disabled={!canWrite} value={opening} placeholder="Owed to you: 1000. Owed by you: -1000" onChange={(e) => setOpening(e.target.value)} /></div>
          <div><label htmlFor="xd">As on</label><input id="xd" type="date" disabled={!canWrite} value={on} onChange={(e) => setOn(e.target.value)} /></div>
        </div>
        <p className="muted">The credit limit is the most you are happy for this customer to owe. Kora tells you here when it is passed; it never stops an invoice. The opening balance is what was owed before you started using Kora, and it shows on the statement.</p>
        {canWrite && <button>Save</button>}
        {msg && <p className="ok" role="status">{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>

      <div className="panel" aria-label="Notes">
        <h2>Notes</h2>
        {canWrite && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/parties/${partyId}/notes`, { body: { body: note } }); setNote(''); }); }}>
            <div><label htmlFor="xn">Add a note</label><input id="xn" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <button style={{ flex: 'none' }} disabled={!note.trim()}>Add note</button>
          </form>)}
        {notes.length === 0 ? <p className="muted">No notes yet.</p> : (
          <ul className="plain">{notes.map((n) => (
            <li key={n.id}><span>{n.body} <span className="muted">{n.author}, {new Date(n.createdAt).toLocaleDateString('en-IN')}</span></span>
              {(n.mine || isOwner) && <button className="link" onClick={() => void run(async () => { await api(`/api/parties/${partyId}/notes?note=${n.id}`, { method: 'DELETE' }); })}>Remove</button>}</li>))}</ul>)}
      </div>
    </>
  );
}
