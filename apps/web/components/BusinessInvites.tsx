'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';

type Invite = { businessId: string; name: string; role: string };

/** Businesses that have added this person and are waiting for a yes or a no. Nothing of the business is open to them until they accept. */
export default function BusinessInvites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/api/invites').then((r) => setInvites(r.invites)).catch(() => {}); }, []);
  if (invites.length === 0 && !err) return null;
  const answer = async (businessId: string, accept: boolean) => {
    setErr(''); setBusy(businessId);
    try { await api('/api/invites', { body: { businessId, accept } }); window.location.href = accept ? '/app' : window.location.pathname; }
    catch (e) { setErr((e as Error).message); setBusy(''); }
  };
  return (
    <section className="panel" aria-label="Invitations">
      <h2>You have been invited</h2>
      {err && <p className="error" role="alert">{err}</p>}
      {invites.map((i) => (
        <p key={i.businessId}><b>{i.name}</b> has added you as <b>{i.role}</b>.{' '}
          <button className="btn" disabled={busy === i.businessId} onClick={() => answer(i.businessId, true)}>Accept</button>{' '}
          <button className="secondary" disabled={busy === i.businessId} onClick={() => answer(i.businessId, false)}>Decline</button></p>
      ))}
    </section>
  );
}
