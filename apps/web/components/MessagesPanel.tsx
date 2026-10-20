'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';

type Data = { invoice: string | null; reminder: string | null; defaults: { invoice: string; reminder: string }; fields: [string, string][] };
const SAMPLE: Record<string, string> = { customer: 'Asha Stores', type: 'Tax invoice', number: 'INV/26-27/0042', amount: 'Rs 11,800.00', outstanding: 'Rs 5,900.00', due_date: '2026-11-17', business: 'Your Business', link: 'https://kora.example/i/abc123' };
const fill = (t: string) => t.replace(/\{([a-z_]+)\}/g, (_, k: string) => SAMPLE[k] ?? '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();

/** The words sent with an invoice or a reminder. A business can write its own, with placeholders; Kora's wording is used until it does. */
export default function MessagesPanel({ canWrite }: { canWrite: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [text, setText] = useState({ invoice: '', reminder: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const refs = { invoice: useRef<HTMLTextAreaElement>(null), reminder: useRef<HTMLTextAreaElement>(null) };

  const load = async () => {
    const r: Data = await api('/api/messages');
    setD(r); setText({ invoice: r.invoice ?? r.defaults.invoice, reminder: r.reminder ?? r.defaults.reminder });
  };
  useEffect(() => { void load().catch((e) => setErr(e.message)); }, []);
  if (!d) return err ? <p className="error" role="alert">{err}</p> : null;

  const save = async (kind: 'invoice' | 'reminder', value: string | null) => {
    setErr(''); setMsg('');
    try { await api('/api/messages', { method: 'PUT', body: { [kind]: value } }); await load(); setMsg(value === null ? `The ${kind} message is back to Kora's wording.` : `The ${kind} message is saved.`); }
    catch (e) { setErr((e as Error).message); }
  };
  const insert = (kind: 'invoice' | 'reminder', field: string) => {
    const el = refs[kind].current;
    const at = el?.selectionStart ?? text[kind].length;
    setText({ ...text, [kind]: `${text[kind].slice(0, at)}{${field}}${text[kind].slice(el?.selectionEnd ?? at)}` });
    setTimeout(() => { el?.focus(); const pos = at + field.length + 2; el?.setSelectionRange(pos, pos); }, 0);
  };

  return (
    <section className="panel" aria-label="Messages">
      <h2>Messages</h2>
      <p className="muted">The wording that goes out on WhatsApp, SMS and email with an invoice or a reminder. Click a name to put it in. The link must stay in.</p>
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {(['invoice', 'reminder'] as const).map((kind) => (
        <div key={kind} style={{ marginTop: 14 }}>
          <label htmlFor={`msg-${kind}`}>{kind === 'invoice' ? 'When you send a document' : 'When a reminder goes out'}</label>
          <textarea id={`msg-${kind}`} ref={refs[kind]} maxLength={500} disabled={!canWrite} value={text[kind]} onChange={(e) => setText({ ...text, [kind]: e.target.value })} />
          {canWrite && (
            <div className="chips" role="group" aria-label={`Names you can put in the ${kind} message`}>
              {d.fields.map(([k, what]) => <button key={k} type="button" className="secondary sm" title={what} onClick={() => insert(kind, k)}>{`{${k}}`}</button>)}
            </div>)}
          <p className="muted" aria-live="polite"><b>Looks like:</b> {fill(text[kind])}</p>
          {canWrite && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <button type="button" style={{ flex: 'none' }} onClick={() => void save(kind, text[kind])}>Save {kind} message</button>
              {(kind === 'invoice' ? d.invoice : d.reminder) !== null && <button type="button" className="secondary" style={{ flex: 'none' }} onClick={() => void save(kind, null)}>Use Kora&rsquo;s wording</button>}
            </div>)}
        </div>))}
    </section>
  );
}
