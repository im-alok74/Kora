'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api } from '../../../lib/client';

type Item = {
  id: string; title: string; note: string | null; file_name: string; content_type: string; status: 'new' | 'done' | 'rejected';
  review_note: string | null; created_at: string; reviewed_at: string | null; uploaded_by_email: string | null; reviewed_by_email: string | null;
};
const LABEL = { new: 'To review', done: 'Done', rejected: 'Sent back' } as const;
const CHIP = { new: 'issued', done: 'paid', rejected: 'cancelled' } as const;
const MAX = 2 * 1024 * 1024;

const toBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] ?? '');
  r.onerror = () => rej(new Error('The file could not be read.'));
  r.readAsDataURL(f);
});

/** Bills and papers handed over by the business, for the accountant to work through. */
export default function Inbox() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [role, setRole] = useState('');
  const [tab, setTab] = useState<'all' | 'new' | 'done' | 'rejected'>('new');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setItems((await api(`/api/inbox${tab === 'all' ? '' : `?status=${tab}`}`)).items); }, [tab]);
  useEffect(() => { load().catch((e) => setErr(e.message)); api('/api/business').then((b) => setRole(b.role)); }, [load]);

  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const canSend = role === 'owner' || role === 'staff';
  const canReview = role === 'owner' || role === 'accountant';

  return (
    <>
      <div className="toolbar"><div><h1>Inbox</h1><p className="page-sub">Bills and papers sent over for your accountant. Add what you have, and they will mark it done or tell you what is missing.</p></div></div>

      {canSend && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; void run(async () => {
          if (!file) throw new Error('Choose a photo or PDF to send.');
          if (file.size > MAX) throw new Error('The file is larger than 2 MB. Use a smaller photo.');
          await api('/api/inbox', { body: { title, note: note || undefined, name: file.name, type: file.type, data: await toBase64(file) } });
          setTitle(''); setNote(''); setFile(null); form.reset(); setMsg('Sent to your accountant.'); await load();
        }); }}>
          <p className="section-label">Send something</p>
          <div className="row">
            <div><label htmlFor="it" style={{ marginTop: 0 }}>What is it?</label><input id="it" value={title} maxLength={120} placeholder="For example, September rent bill" onChange={(e) => setTitle(e.target.value)} required /></div>
            <div><label htmlFor="if" style={{ marginTop: 0 }}>Photo or PDF</label><input id="if" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></div>
          </div>
          <label htmlFor="in">Note for your accountant (optional)</label>
          <input id="in" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy} style={{ marginTop: 12 }}><Icon name="plus" size={16} />Send</button>
        </form>
      )}

      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <div className="tabs" role="group" aria-label="Filter by status">
        {(['new', 'done', 'rejected', 'all'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{k === 'all' ? 'All' : LABEL[k]}</button>))}
      </div>

      {items === null && !err && <KoraLoader />}
      {items && items.length === 0 && (
        <div className="panel empty"><Icon name="inbox" size={34} style={{ color: 'var(--text-faint)' }} /><h3>Nothing here.</h3><p>{tab === 'new' ? 'Nothing is waiting to be reviewed.' : 'No items in this view.'}</p></div>)}
      {items && items.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>{items.map((i) => (
          <article key={i.id} className="panel" style={{ margin: 0 }} aria-label={i.title}>
            <div className="row" style={{ alignItems: 'center' }}>
              <div style={{ flex: 3 }}>
                <b>{i.title}</b> <span className={`chip ${CHIP[i.status]}`}>{LABEL[i.status]}</span>
                <div className="muted" style={{ fontSize: 13 }}>{i.uploaded_by_email ?? 'Someone'} · {new Date(i.created_at).toLocaleString('en-IN')} · <a href={`/api/inbox/${i.id}/file`} target="_blank" rel="noreferrer">{i.file_name}</a></div>
                {i.note && <p style={{ margin: '6px 0 0' }}>{i.note}</p>}
                {i.review_note && <p className="error" style={{ margin: '6px 0 0' }}>Sent back: {i.review_note}</p>}
                {i.status === 'done' && i.reviewed_by_email && <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Done by {i.reviewed_by_email}.</p>}
              </div>
              <div className="row" style={{ flex: 'none', justifyContent: 'flex-end' }}>
                {canReview && i.status === 'new' && <button disabled={busy} onClick={() => run(async () => { await api(`/api/inbox/${i.id}`, { method: 'PATCH', body: { status: 'done' } }); await load(); })}>Mark done</button>}
                {canReview && i.status === 'new' && <button className="secondary" disabled={busy} onClick={() => { setReasonFor(reasonFor === i.id ? null : i.id); setReason(''); }}>Send back</button>}
                {canReview && i.status !== 'new' && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/inbox/${i.id}`, { method: 'PATCH', body: { status: 'new' } }); await load(); })}>Reopen</button>}
                {(role === 'owner' || (i.status === 'new' && canSend)) && <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/inbox/${i.id}`, { method: 'DELETE' }); await load(); })}>Remove</button>}
              </div>
            </div>
            {reasonFor === i.id && (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/inbox/${i.id}`, { method: 'PATCH', body: { status: 'rejected', reviewNote: reason } }); setReasonFor(null); await load(); }); }}>
                <label htmlFor={`r${i.id}`}>What is wrong?</label>
                <input id={`r${i.id}`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} required />
                <button className="danger" disabled={busy} style={{ marginTop: 10 }}>Send back</button>
              </form>)}
          </article>))}
        </div>
      )}
    </>
  );
}
