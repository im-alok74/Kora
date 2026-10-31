'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Invite = { userId: string; role: string; phone: string | null; email: string | null };
type Member = { userId: string; role: string; phone: string | null; email: string | null; name: string | null };
const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including settings, people and cancelling.',
  staff: 'Create, issue and send documents; record payments.',
  accountant: 'Read everything and export reports. Cannot change anything.',
};

export default function Team() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [you, setYou] = useState('');
  const [role, setRole] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [t, b] = await Promise.all([api('/api/team'), api('/api/business')]);
    setMembers(t.members); setYou(t.you); setRole(b.role);
    if (b.role === 'owner') setInvites((await api('/api/team/invites')).invites);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  const isOwner = role === 'owner';

  return (
    <>
      <h1>Team</h1>
      <p className="muted">People sign in with their own mobile number or email and a one-time code. There are no passwords to share.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {isOwner && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/team', { body: { identifier, role: newRole } }); setMsg(`Invited. Ask them to sign in at Kora with ${identifier} and accept; they join once they do.`); setIdentifier(''); }); }}>
          <h2>Invite a person</h2>
          <div className="row">
            <div><label htmlFor="ti">Mobile number or email</label><input id="ti" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></div>
            <div><label htmlFor="tr">Role</label><select id="tr" value={newRole} onChange={(e) => setNewRole(e.target.value)}><option value="staff">Staff</option><option value="accountant">Accountant</option><option value="owner">Owner</option></select></div>
            <button style={{ flex: 'none' }}>Send invitation</button>
          </div>
          <p className="muted">{ROLE_HELP[newRole]}</p>
        </form>
      )}
      {isOwner && invites.length > 0 && (
        <section className="panel" aria-label="Waiting for an answer">
          <h2>Waiting for an answer</h2>
          {invites.map((i) => (
            <p key={i.userId}>{i.phone ?? i.email} as <b>{i.role}</b>{' '}
              <button className="link" onClick={() => run(async () => { await api(`/api/team/invites/${i.userId}`, { method: 'DELETE' }); })}>Cancel</button></p>
          ))}
        </section>
      )}
      <table className="t">
        <thead><tr><th>Person</th><th>Role</th><th /></tr></thead>
        <tbody>{members.map((m) => (
          <tr key={m.userId}>
            <td>{m.name ?? m.phone ?? m.email}{m.userId === you ? ' (you)' : ''}<div className="muted">{m.phone ?? m.email}</div></td>
            <td>{isOwner ? (
              <select aria-label={`Role of ${m.phone ?? m.email}`} value={m.role} onChange={(e) => run(async () => { await api(`/api/team/${m.userId}`, { method: 'PUT', body: { role: e.target.value } }); })}>
                <option value="owner">Owner</option><option value="staff">Staff</option><option value="accountant">Accountant</option></select>
            ) : m.role}<div className="muted">{ROLE_HELP[m.role]}</div></td>
            <td className="n">{isOwner && <button className="link" onClick={() => run(async () => { await api(`/api/team/${m.userId}`, { method: 'DELETE' }); })}>Remove</button>}</td>
          </tr>))}</tbody>
      </table>
    </>
  );
}
