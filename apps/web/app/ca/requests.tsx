'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/client';
import FeePanel from './fee';
import Review from './review';

type Version = { id: string; fileName: string; uploadedVia: string; createdAt: string };
type Req = { id: string; label: string; status: 'requested' | 'received' | 'needs_correction' | 'accepted' | 'waived'; reason: string | null; dueDate: string | null; versions: Version[] };
type Data = { requests: Req[]; link: { active: boolean; expiresAt?: string } };

const SAYS: Record<Req['status'], string> = { requested: 'Waiting for the client', received: 'Received', needs_correction: 'Sent back', accepted: 'Accepted', waived: 'Not needed' };
const toBase64 = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('The file could not be read.')); r.readAsDataURL(f); });

/** The checklist for one piece of work: what is needed, what has come in, and the link the client uses to send it. */
export default function Requests({ engagementId, wide = false, onChange }: { engagementId: string; wide?: boolean; onChange?: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [deciding, setDeciding] = useState<{ id: string; decision: 'needs_correction' | 'waived' } | null>(null);
  const [why, setWhy] = useState('');
  // onChange is a new function on every render of the page, so it must never be a dependency of load (that made the panel reload itself forever).
  const changed = useRef(onChange);
  changed.current = onChange;
  const load = useCallback(async () => { setD(await api<Data>(`/api/ca/engagements/${engagementId}/requests`)); }, [engagementId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); changed.current?.(); } catch (e) { setErr((e as Error).message); } };

  if (!d) return err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  return (
    <div>
      {err && <p className="error" role="alert">{err}</p>}
      <p>
        {d.requests.length === 0 && <button className="secondary" onClick={() => run(() => api(`/api/ca/engagements/${engagementId}/requests`, { body: { defaults: true } }))}>Add the standard list</button>}{' '}
        <button className="secondary" onClick={() => run(async () => { const r = await api<{ url: string }>(`/api/ca/engagements/${engagementId}/upload-link`, { body: {} }); setUrl(r.url); })}>
          {d.link.active ? 'Make a new link for the client' : 'Make a link for the client'}</button>
        {d.link.active && <> <button className="link" onClick={() => run(async () => { await api(`/api/ca/engagements/${engagementId}/upload-link`, { method: 'DELETE' }); setUrl(''); })}>Stop the link</button></>}
      </p>
      {url && <p role="status">Send this to the client (shown once, valid 14 days; a new link stops the old one):<br /><input readOnly aria-label="Link for the client" value={url} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} /></p>}
      {d.link.active && !url && <p className="muted">A link is live until {d.link.expiresAt?.slice(0, 10)}. It cannot be shown again; make a new one to copy it.</p>}

      {d.requests.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <b>{r.label}</b> <span className={r.status === 'needs_correction' ? 'chip cancelled' : 'chip'}>{SAYS[r.status]}</span>
          {r.dueDate && <span className="muted"> · by {r.dueDate}</span>}
          {r.reason && <div className="muted">{r.reason}</div>}
          {r.versions.map((v, i) => <div key={v.id} style={{ fontSize: 13 }}><a href={`/api/ca/files/${v.id}`}>{v.fileName}</a> <span className="muted">{i === 0 ? 'latest · ' : ''}sent by {v.uploadedVia === 'link' ? 'the client' : 'your team'} on {v.createdAt.slice(0, 10)}</span></div>)}
          <div style={{ fontSize: 13 }}>
            {r.status === 'received' && <button className="link" onClick={() => run(() => api(`/api/ca/requests/${r.id}`, { method: 'PATCH', body: { decision: 'accepted' } }))}>Accept</button>}{' '}
            {(r.status === 'received' || r.status === 'requested') && <button className="link" onClick={() => { setDeciding({ id: r.id, decision: 'needs_correction' }); setWhy(''); }}>Send back</button>}{' '}
            {(r.status === 'requested' || r.status === 'received' || r.status === 'needs_correction') && <button className="link" onClick={() => { setDeciding({ id: r.id, decision: 'waived' }); setWhy(''); }}>Not needed</button>}
            {(r.status === 'accepted' || r.status === 'waived' || r.status === 'needs_correction') && <button className="link" onClick={() => run(() => api(`/api/ca/requests/${r.id}`, { method: 'PATCH', body: { decision: 'requested' } }))}>Reopen</button>}
          </div>
          {deciding?.id === r.id && (
            <form className="filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/ca/requests/${r.id}`, { method: 'PATCH', body: { decision: deciding.decision, reason: why } }); setDeciding(null); }); }}>
              <div style={{ flex: 3 }}><label htmlFor={`why${r.id}`}>{deciding.decision === 'waived' ? 'Why is it not needed?' : 'What is wrong? The client will see this.'}</label><input id={`why${r.id}`} value={why} onChange={(e) => setWhy(e.target.value)} required maxLength={500} /></div>
              <button className="btn">Save</button> <button type="button" className="secondary" onClick={() => setDeciding(null)}>Cancel</button>
            </form>
          )}
          {r.status !== 'accepted' && r.status !== 'waived' && (
            <div><label htmlFor={`sf${r.id}`} className="muted" style={{ fontSize: 13 }}>Add a file you received</label>{' '}
              <input id={`sf${r.id}`} type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => api(`/api/ca/requests/${r.id}/files`, { body: { name: f.name, type: f.type, data: await toBase64(f) } })); }} /></div>
          )}
        </div>
      ))}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/ca/engagements/${engagementId}/requests`, { body: { label } }); setLabel(''); }); }}>
        <div style={{ flex: 3 }}><label htmlFor={`nl${engagementId}`}>Ask for something else</label><input id={`nl${engagementId}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="For example: GSTR-2B download" /></div>
        <button className="btn" disabled={!label.trim()}>Add</button>
      </form>
      <Review engagementId={engagementId} version={JSON.stringify(d.requests.map((r) => [r.id, r.status, r.versions[0]?.id ?? null]))} onChange={() => changed.current?.()} />
      <FeePanel engagementId={engagementId} wide={wide} onChange={() => changed.current?.()} />
    </div>
  );
}
