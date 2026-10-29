'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/client';

type Issue = { id: string; text: string; status: 'open' | 'resolved' };
type Sub = { id: string; versionNo: number; status: string; decisionNote: string | null; unchanged: boolean; submittedAt: string; issues: Issue[] };
type State = { effective: 'none' | 'pending' | 'approved' | 'stale' | 'returned'; submission: Sub | null };

const SAYS: Record<State['effective'], string> = {
  none: 'Not sent for review yet', pending: 'Waiting for the reviewer', approved: 'Approved', stale: 'Approval no longer counts: something changed after it', returned: 'Sent back by the reviewer',
};

/** The sign-off on one piece of work: hand it over as a frozen version, raise and resolve points, approve or send back. */
export default function Review({ engagementId, version, onChange }: { engagementId: string; version: string; onChange?: () => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const [point, setPoint] = useState('');
  const [note, setNote] = useState('');
  const [back, setBack] = useState(false);
  const load = useCallback(async () => { setSt(await api<State>(`/api/ca/engagements/${engagementId}/review`)); onChange?.(); }, [engagementId, onChange]);
  // Reload when the checklist beside it changes, so a stale approval shows as soon as it happens.
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load, version]);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!st) return err ? <p className="error" role="alert">{err}</p> : null;
  const sub = st.submission;
  const open = sub?.issues.filter((i) => i.status === 'open').length ?? 0;

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
      <h3 style={{ fontSize: 16 }}>Review</h3>
      <p><span className={st.effective === 'approved' ? 'chip paid' : st.effective === 'stale' || st.effective === 'returned' ? 'chip cancelled' : 'chip'}>{SAYS[st.effective]}</span>
        {sub && <span className="muted"> · version {sub.versionNo}</span>}</p>
      {sub?.status === 'pending' && !sub.unchanged && <p className="error" role="alert">The checklist or its files changed after this version was sent. It cannot be approved; send a new version.</p>}
      {sub?.decisionNote && <p className="muted">Reviewer’s note: {sub.decisionNote}</p>}
      {err && <p className="error" role="alert">{err}</p>}

      {sub?.issues.map((i) => (
        <div key={i.id} style={{ fontSize: 14 }}>{i.status === 'open' ? '○' : '✓'} {i.text} {i.status === 'open' && sub.status === 'pending' && <button className="link" onClick={() => run(() => api(`/api/ca/issues/${i.id}`, { method: 'PATCH', body: {} }))}>Mark dealt with</button>}</div>
      ))}

      <p>
        <button className="secondary" onClick={() => run(() => api(`/api/ca/engagements/${engagementId}/review`, { body: {} }))}>{sub && sub.status !== 'superseded' ? 'Send a new version for review' : 'Send for review'}</button>
      </p>

      {sub?.status === 'pending' && (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/ca/submissions/${sub.id}/issues`, { body: { text: point } }); setPoint(''); }); }}>
            <div style={{ flex: 3 }}><label htmlFor={`pt${sub.id}`}>Raise a point (reviewer)</label><input id={`pt${sub.id}`} value={point} onChange={(e) => setPoint(e.target.value)} maxLength={1000} /></div>
            <button className="secondary" disabled={!point.trim()}>Raise</button>
          </form>
          <p>
            <button className="btn" disabled={open > 0 || !sub.unchanged} title={open > 0 ? `${open} point(s) still open` : ''} onClick={() => run(() => api(`/api/ca/submissions/${sub.id}`, { method: 'PATCH', body: { decision: 'approved' } }))}>Approve this version</button>{' '}
            <button className="secondary" onClick={() => setBack(!back)}>Send back</button>
          </p>
          {back && (
            <form className="filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/ca/submissions/${sub.id}`, { method: 'PATCH', body: { decision: 'returned', note } }); setBack(false); setNote(''); }); }}>
              <div style={{ flex: 3 }}><label htmlFor={`bn${sub.id}`}>What needs to change?</label><input id={`bn${sub.id}`} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={1000} /></div>
              <button className="btn">Send back</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
