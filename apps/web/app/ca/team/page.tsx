'use client';
import { useCallback, useEffect, useState } from 'react';
import KoraLoader from '../../../components/KoraLoader';
import { api } from '../../../lib/client';

type Member = { userId: string; email: string; role: string; pending?: boolean };
type Me = { you: string; role: string; members: Member[] };

const HELP: Record<string, string> = {
  partner: 'Everything, including adding and removing people.',
  manager: 'Sees every client; sets up work, assigns people, closes work.',
  preparer: 'Works on the clients given to them; cannot approve their own work.',
  reviewer: 'Reviews the clients given to them and approves or sends back.',
};

export default function Team() {
  const [me, setMe] = useState<Me | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState('preparer');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => setMe(await api<Me>('/api/ca/firm')), []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setNote(''); try { await fn(); await load(); if (ok) setNote(ok); } catch (e) { setErr((e as Error).message); } };

  if (!me) return err ? <p className="error" role="alert">{err}</p> : <KoraLoader />;
  const isPartner = me.role === 'partner';
  return (
    <>
      <div className="toolbar"><div><h1>Team</h1><p className="page-sub">The people in your firm and what each can do.</p></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}

      {isPartner && (
        <form className="panel filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/ca/team', { body: { identifier, role } }); setIdentifier(''); }, 'Added. They sign in with that number or email, using a one-time code.'); }}>
          <div style={{ flex: 3 }}><label htmlFor="ti">Mobile number or email</label><input id="ti" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></div>
          <div><label htmlFor="tr">Role</label>
            <select id="tr" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="preparer">Preparer</option><option value="reviewer">Reviewer</option><option value="manager">Manager</option><option value="partner">Partner</option>
            </select></div>
          <button className="btn">Add</button>
          <p className="muted" style={{ flexBasis: '100%', margin: 0 }}>{HELP[role]} Adding someone who is already here changes their role.</p>
        </form>
      )}

      <table className="t ca-table" aria-label="Team">
        <thead><tr><th>Person</th><th>Role</th><th>Can</th>{isPartner && <th />}</tr></thead>
        <tbody>{me.members.map((m) => (
          <tr key={m.userId}>
            <td data-label="Person"><b>{m.email}</b>{m.userId === me.you && <> <span className="chip">you</span></>}{m.pending && <> <span className="chip" title="They have not accepted yet. Nothing of the firm is open to them.">waiting to accept</span></>}</td>
            <td data-label="Role">{isPartner ? (
              <select aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => run(() => api('/api/ca/team', { body: { identifier: m.email, role: e.target.value } }))}>
                <option value="preparer">Preparer</option><option value="reviewer">Reviewer</option><option value="manager">Manager</option><option value="partner">Partner</option>
              </select>) : m.role}</td>
            <td data-label="Can" className="muted">{HELP[m.role]}</td>
            {isPartner && <td><button className="link" onClick={() => { if (window.confirm(`Remove ${m.email} from the firm? They lose access to its work.`)) void run(() => api(`/api/ca/team?userId=${m.userId}`, { method: 'DELETE' })); }}>Remove</button></td>}
          </tr>))}</tbody>
      </table>
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Giving a preparer or reviewer a client is done on the Clients page.</p>
    </>
  );
}
