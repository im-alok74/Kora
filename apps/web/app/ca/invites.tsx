'use client';
import { useState } from 'react';
import { api } from '../../lib/client';

export type Invite = { firmId: string; name: string; role: string };

/** Firms that have added this person and are waiting for a yes or a no. Nothing of the firm is open to them until they accept. */
export default function Invites({ invites }: { invites: Invite[] }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  if (invites.length === 0) return null;
  const answer = async (firmId: string, accept: boolean) => {
    setErr(''); setBusy(firmId);
    try { await api('/api/ca/firm/invite', { body: { firmId, accept } }); window.location.href = accept ? '/ca' : window.location.pathname; }
    catch (e) { setErr((e as Error).message); setBusy(''); }
  };
  return (
    <section className="panel" aria-label="Invitations">
      <h2>You have been invited</h2>
      {err && <p className="error" role="alert">{err}</p>}
      {invites.map((i) => (
        <p key={i.firmId}><b>{i.name}</b> has added you as a <b>{i.role}</b>.{' '}
          <button className="btn" disabled={busy === i.firmId} onClick={() => answer(i.firmId, true)}>Accept</button>{' '}
          <button className="secondary" disabled={busy === i.firmId} onClick={() => answer(i.firmId, false)}>Decline</button></p>
      ))}
    </section>
  );
}
