'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Info = { codeRequired: boolean; destinations: { sms: string | null; email: string | null } };

/** Shown when the business asks for a code: the customer picks where it goes, types it, and the portal opens. */
export function CodeGate({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/portal/${token}/login`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);

  const send = async (channel?: 'sms' | 'email') => {
    setErr(''); setBusy(true);
    try { const r = await api(`/api/portal/${token}/login`, { body: { channel } }); setSent(`${r.to}`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setErr(''); setBusy(true);
    try { await api(`/api/portal/${token}/verify`, { body: { code } }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const d = info?.destinations;
  return (
    <main className="portal" style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <h1>Open your account</h1>
      <p className="muted">For your safety we send a code before showing your account.</p>
      {!sent ? (
        <div className="panel">
          {d && !d.sms && !d.email && <p className="error" role="alert">There is no email or mobile number on record to send a code to. Please contact the business.</p>}
          {d?.email && <button disabled={busy} style={{ width: '100%' }} onClick={() => void send('email')}>Email a code to {d.email}</button>}
          {d?.sms && <button disabled={busy} className={d.email ? 'secondary' : ''} style={{ width: '100%', marginTop: 10 }} onClick={() => void send('sms')}>Text a code to {d.sms}</button>}
        </div>
      ) : (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <p>We sent a 6 digit code to {sent}. It works for 10 minutes.</p>
          <label htmlFor="pcode">Code</label>
          <input id="pcode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          <button disabled={busy || code.length !== 6} style={{ marginTop: 12 }}>Open my account</button>
          <button type="button" className="link" disabled={busy} onClick={() => { setSent(null); setCode(''); }}>Send a new code</button>
        </form>)}
      {err && <p className="error" role="alert">{err}</p>}
    </main>
  );
}

type Talk = { comments: { id: string; author: 'customer' | 'business'; body: string; created_at: string }[]; files: { id: string; file_name: string; size_bytes: number }[] };

/** Comments on one document, and for an estimate, a place to attach the purchase order. */
export function DocTalk({ token, id, number, estimate }: { token: string; id: string; number: string; estimate: boolean }) {
  const [t, setT] = useState<Talk | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api(`/api/portal/${token}/doc/${id}`).then(setT).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [token, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async () => {
    setErr(''); setMsg('');
    try { await api(`/api/portal/${token}/doc/${id}`, { body: { body: text } }); setText(''); setMsg('Your comment has been sent.'); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setMsg('');
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await api(`/api/portal/${token}/doc/${id}/po`, { body: { name: f.name, type: f.type, dataBase64: btoa(bin) } });
      setMsg('Your purchase order has been attached.'); await load();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div style={{ padding: '8px 0' }}>
      {t?.comments.length ? (
        <ul className="plain" aria-label={`Comments on ${number}`}>{t.comments.map((c) => (
          <li key={c.id}><span><b>{c.author === 'customer' ? 'You' : 'The business'}</b>: {c.body}</span><span className="muted">{new Date(c.created_at).toLocaleDateString('en-IN')}</span></li>))}</ul>
      ) : <p className="muted">No comments yet.</p>}
      <label htmlFor={`c${id}`}>Write a comment on {number}</label>
      <textarea id={`c${id}`} rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="secondary" style={{ marginTop: 8 }} disabled={!text.trim()} onClick={() => void post()}>Send comment</button>
      {estimate && (<>
        <label htmlFor={`po${id}`} style={{ marginTop: 14 }}>Attach your purchase order (PDF, JPEG or PNG, up to 2 MB)</label>
        <input id={`po${id}`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        {t?.files.length ? <ul className="plain" aria-label="Attached files">{t.files.map((f) => <li key={f.id}><span>{f.file_name}</span><span className="muted">{Math.ceil(f.size_bytes / 1024)} KB</span></li>)}</ul> : null}
      </>)}
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
