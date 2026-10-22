'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/client';

type Activity = {
  comments: { id: string; author: 'customer' | 'business'; body: string; created_at: string; document_id: string; number: string }[];
  files: { id: string; file_name: string; size_bytes: number; created_at: string; document_id: string; number: string }[];
};

/** What the customer does on their portal: the sign-in code switch, what they wrote, and the purchase orders they sent. */
export default function PortalPanel({ partyId, canWrite }: { partyId: string; canWrite: boolean }) {
  const [status, setStatus] = useState<{ active: boolean; code_login?: boolean } | null>(null);
  const [act, setAct] = useState<Activity | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    setStatus(await api(`/api/parties/${partyId}/portal`));
    setAct(await api(`/api/parties/${partyId}/portal/activity`));
  }, [partyId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };

  if (!status) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  return (
    <>
      <div className="panel" aria-label="Portal sign-in">
        <h2>Portal sign-in</h2>
        {!status.active ? <p className="muted">There is no portal link for this customer yet. Make one from the Customers list, then come back here.</p> : (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto', height: 'auto' }} disabled={!canWrite} checked={!!status.code_login}
              onChange={(e) => void run(async () => { await api(`/api/parties/${partyId}/portal/settings`, { method: 'PUT', body: { codeLogin: e.target.checked } }); setMsg(e.target.checked ? 'The customer will now need a code sent to their email or mobile number.' : 'The link alone opens the portal again.'); })} />
            Ask for a code sent to their email or mobile number before the portal opens
          </label>)}
        <p className="muted">The code goes to the email or number saved on this customer, never to anything typed on the portal.</p>
        {msg && <p className="ok" role="status">{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
      <div className="panel" aria-label="Customer comments">
        <h2>What the customer wrote</h2>
        {!act || act.comments.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="plain">{act.comments.map((c) => (
            <li key={c.id} style={{ display: 'block' }}>
              <div><b>{c.author === 'customer' ? 'Customer' : 'You'}</b> on {c.number}: {c.body} <span className="muted">{new Date(c.created_at).toLocaleDateString('en-IN')}</span></div>
              {canWrite && c.author === 'customer' && (
                <div className="row" style={{ marginTop: 6 }}>
                  <input aria-label={`Reply about ${c.number}`} maxLength={1000} value={reply[c.id] ?? ''} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} />
                  <button className="secondary" style={{ flex: 'none' }} disabled={!(reply[c.id] ?? '').trim()}
                    onClick={() => void run(async () => { await api(`/api/parties/${partyId}/portal/activity`, { body: { documentId: c.document_id, body: reply[c.id] } }); setReply({ ...reply, [c.id]: '' }); })}>Reply</button>
                </div>)}
            </li>))}</ul>)}
      </div>
      <div className="panel" aria-label="Purchase orders">
        <h2>Purchase orders from the customer</h2>
        {!act || act.files.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="plain">{act.files.map((f) => (
            <li key={f.id}><a href={`/api/documents/${f.document_id}/files/${f.id}`} target="_blank" rel="noreferrer">{f.file_name}</a><span className="muted">for {f.number}, {new Date(f.created_at).toLocaleDateString('en-IN')}</span></li>))}</ul>)}
      </div>
    </>
  );
}
