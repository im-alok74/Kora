'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/client';

type Issue = { id: string; text: string; status: 'open' | 'resolved' };
type Sub = { id: string; versionNo: number; status: string; decisionNote: string | null; unchanged: boolean; submittedAt: string; issues: Issue[] };
type Ev = { id: string; reference: string; filedOn: string; fileName: string };
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
  const [ev, setEv] = useState<Ev[]>([]);
  const [f, setF] = useState({ reference: '', filedOn: '' });
  const load = useCallback(async () => {
    const [r, e] = await Promise.all([api<State>(`/api/ca/engagements/${engagementId}/review`), api<{ evidence: Ev[] }>(`/api/ca/engagements/${engagementId}/filing`)]);
    setSt(r); setEv(e.evidence);
  }, [engagementId]);
  // Reload when the checklist beside it changes, so a stale approval shows as soon as it happens.
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load, version]);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); onChange?.(); } catch (e) { setErr((e as Error).message); } };
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
      <h3 style={{ fontSize: 16, marginTop: 16 }}>Filing</h3>
      {ev.map((x) => <div key={x.id} style={{ fontSize: 14 }}>Marked filed: reference <b>{x.reference}</b> on {x.filedOn} · <a href={`/api/ca/evidence/${x.id}`}>{x.fileName}</a></div>)}
      {ev.length > 0 && <p className="muted" style={{ fontSize: 13 }}>This is your team’s own record. Kora has not checked it with the GST portal.</p>}
      {st.effective === 'approved' ? (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); const file = (e.currentTarget.elements.namedItem('ack') as HTMLInputElement).files?.[0]; if (!file) return; void run(async () => {
            const data = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('The file could not be read.')); r.readAsDataURL(file); });
            await api(`/api/ca/engagements/${engagementId}/filing`, { body: { reference: f.reference, filedOn: f.filedOn, name: file.name, type: file.type, data } });
            setF({ reference: '', filedOn: '' });
          }); }}>
            <div style={{ flex: 2 }}><label htmlFor={`fr${engagementId}`}>Reference (ARN)</label><input id={`fr${engagementId}`} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required maxLength={60} /></div>
            <div><label htmlFor={`fd${engagementId}`}>Filed on</label><input id={`fd${engagementId}`} type="date" value={f.filedOn} onChange={(e) => setF({ ...f, filedOn: e.target.value })} required /></div>
            <div><label htmlFor={`fa${engagementId}`}>Acknowledgement file</label><input id={`fa${engagementId}`} name="ack" type="file" accept="image/jpeg,image/png,application/pdf" required /></div>
            <button className="secondary">Record the filing</button>
          </form>
          <p><button className="btn" disabled={ev.length === 0} title={ev.length === 0 ? 'Record the filing first' : ''} onClick={() => run(() => api(`/api/ca/engagements/${engagementId}/close`, { body: {} }))}>Close this work</button></p>
        </>
      ) : <p className="muted">A filing can be recorded once the review is approved.</p>}
    </div>
  );
}
