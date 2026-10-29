'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Item = { id: string; label: string; status: 'requested' | 'received' | 'needs_correction' | 'accepted' | 'waived'; reason: string | null; dueDate: string | null };
type Page = { firm: string; client: string; work: string; items: Item[] };

const SAYS: Record<Item['status'], string> = { requested: 'Needed', received: 'Received, thank you', needs_correction: 'Please send again', accepted: 'Accepted', waived: 'Not needed' };
const toBase64 = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('The file could not be read.')); r.readAsDataURL(f); });

/** The page a client opens from the link their CA sent. No sign-in; the link is the only key. */
export default function Send({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [page, setPage] = useState<Page | null>(null);
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try { setPage(await api<Page>(`/api/ca/upload/${token}`)); } catch (e) { if ((e as { status?: number }).status === 404) setGone(true); else setErr((e as Error).message); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const send = async (item: Item, file: File | undefined) => {
    if (!file) return;
    setErr(''); setDone(''); setBusy(item.id);
    try {
      await api(`/api/ca/upload/${token}`, { body: { requestId: item.id, name: file.name, type: file.type, data: await toBase64(file) } });
      setDone(`Sent: ${item.label}`);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  if (gone) return <div className="panel" style={{ maxWidth: 560, margin: '48px auto' }}><h1>This link is not valid any more</h1><p className="muted">It may have expired or been replaced. Ask your CA for a new one.</p></div>;
  if (!page) return err ? <p className="error" role="alert" style={{ margin: 24 }}>{err}</p> : <p className="muted" style={{ margin: 24 }}>Opening…</p>;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }} role="main" id="main-content">
      <h1>Documents for {page.firm}</h1>
      <p className="muted">{page.client} · {page.work}. Send a photo or a PDF (up to 2 MB each) for each item below.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {done && <p role="status">{done}</p>}
      {page.items.length === 0 && <div className="panel"><p>Nothing has been asked for yet.</p></div>}
      {page.items.map((i) => (
        <div className="panel" key={i.id}>
          <h2 style={{ fontSize: 17 }}>{i.label}</h2>
          <p><span className={i.status === 'needs_correction' ? 'chip cancelled' : 'chip'}>{SAYS[i.status]}</span>{i.dueDate && i.status === 'requested' ? <> <span className="muted">by {i.dueDate}</span></> : null}</p>
          {i.reason && <p className="muted">{i.reason}</p>}
          {(i.status === 'requested' || i.status === 'needs_correction' || i.status === 'received') && (
            <>
              <label htmlFor={`f${i.id}`}>{i.status === 'received' ? 'Send another file' : 'Choose a file'}</label>
              <input id={`f${i.id}`} type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy === i.id} onChange={(e) => { void send(i, e.target.files?.[0]); e.target.value = ''; }} />
              {busy === i.id && <p className="muted">Sending…</p>}
            </>
          )}
        </div>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>Only {page.firm} can see what you send here. This page needs no account.</p>
    </div>
  );
}
