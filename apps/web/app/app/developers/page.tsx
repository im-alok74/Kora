'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Key = { id: string; name: string; prefix: string; scope: string; created_at: string; last_used_at: string | null; revoked_at: string | null; created_by: string | null };
type Hook = { id: string; url: string; description: string | null; events: string[]; active: boolean; consecutive_failures: number; last_event_at: string | null; failed: number };
type Delivery = { id: string; event_type: string; status: string; attempts: number; response_status: number | null; error: string | null; created_at: string };

const EVENT_LABEL: Record<string, string> = {
  'document.issued': 'A document is issued', 'document.cancelled': 'A document is cancelled', 'payment.received': 'A payment is received',
  'estimate.accepted': 'An estimate is accepted', 'estimate.declined': 'An estimate is declined',
};
const day = (s: string | null) => (s ? s.slice(0, 10) : 'never');

export default function Developers() {
  const [role, setRole] = useState<string | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [keyName, setKeyName] = useState('');
  const [scope, setScope] = useState('read');
  const [newKey, setNewKey] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [tested, setTested] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setKeys((await api('/api/keys')).keys);
    const w = await api('/api/outbound-webhooks');
    setHooks(w.webhooks); setEvents(w.events);
  }, []);
  useEffect(() => {
    api('/api/business').then((b) => { setRole(b.role); if (b.role === 'owner') void load().catch((e) => setErr(e.message)); });
  }, [load]);

  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (role === null) return <p className="muted">Loading</p>;
  if (role !== 'owner') return <><h1>Developers</h1><p className="muted">API keys and webhooks are managed by the owner.</p></>;

  return (
    <>
      <h1>Developers</h1>
      <p className="muted">Connect Kora to other software. Read the API guide in the repository (<code>docs/api.md</code>) or fetch <a href="/openapi.json">the OpenAPI file</a>.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <section className="panel" aria-label="API keys">
        <h2>API keys</h2>
        <p className="muted">A key lets another program read your data (read) or also create customers, invoices and payments (write). A key can never cancel an invoice, change settings or make more keys. Send it as <code>Authorization: Bearer kora_...</code>.</p>
        {newKey && (
          <div className="panel" role="status" data-testid="new-key" style={{ borderColor: 'var(--accent)' }}>
            <b>Copy this key now. It is shown only once.</b>
            <input readOnly aria-label="New API key" value={newKey} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 8 }} />
            <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(newKey); setMsg('Copied.'); }}>Copy</button>{' '}
            <button className="secondary" onClick={() => setNewKey(null)}>I have saved it</button>
          </div>)}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api('/api/keys', { body: { name: keyName, scope } }); setNewKey(r.key); setKeyName(''); await load(); }); }}>
          <div><label htmlFor="kn">Name</label><input id="kn" placeholder="For example: Zapier" value={keyName} onChange={(e) => setKeyName(e.target.value)} required /></div>
          <div><label htmlFor="ks">Access</label><select id="ks" value={scope} onChange={(e) => setScope(e.target.value)}><option value="read">Read only</option><option value="write">Read and write</option></select></div>
          <div style={{ flex: 'none' }}><button disabled={busy}>Make a key</button></div>
        </form>
        {keys.length > 0 && (
          <table className="t" style={{ marginTop: 12 }}>
            <thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Last used</th><th /></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}{k.revoked_at && <> <span className="chip cancelled">Revoked</span></>}</td><td><code>{k.prefix}…</code></td>
                <td>{k.scope === 'write' ? 'Read and write' : 'Read only'}</td><td>{day(k.last_used_at)}</td>
                <td className="n">{!k.revoked_at && <button className="link" disabled={busy} onClick={() => { if (confirm(`Revoke "${k.name}"? Anything using it stops working.`)) void run(async () => { await api(`/api/keys/${k.id}`, { method: 'DELETE' }); await load(); }); }}>Revoke</button>}</td>
              </tr>))}</tbody></table>)}
      </section>

      <section className="panel" aria-label="Webhooks">
        <h2>Webhooks</h2>
        <p className="muted">Kora sends a signed message to your web address when something happens. Messages can arrive more than once or out of order, so use the event id and the time inside each one.</p>
        {secret && (
          <div className="panel" role="status" data-testid="new-secret" style={{ borderColor: 'var(--accent)' }}>
            <b>Copy the signing secret now. It is shown only once.</b>
            <input readOnly aria-label="Signing secret" value={secret} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 8 }} />
            <button className="secondary" onClick={() => setSecret(null)}>I have saved it</button>
          </div>)}
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const r = await api('/api/outbound-webhooks', { body: { url, description: desc || null, events: events.filter((x) => picked[x]) } });
          setSecret(r.secret); setUrl(''); setDesc(''); setPicked({}); await load(); }); }}>
          <div className="row">
            <div><label htmlFor="wu">Web address (https)</label><input id="wu" placeholder="https://example.com/hooks/kora" value={url} onChange={(e) => setUrl(e.target.value)} required /></div>
            <div><label htmlFor="wd">Note (optional)</label><input id="wd" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
            <legend className="muted">Tell me when</legend>
            {events.map((ev) => (
              <label key={ev} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0' }}>
                <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={!!picked[ev]} onChange={(e) => setPicked({ ...picked, [ev]: e.target.checked })} /> {EVENT_LABEL[ev] ?? ev} <code className="muted">{ev}</code>
              </label>))}
          </fieldset>
          <button disabled={busy}>Add webhook</button>
        </form>

        {hooks.length > 0 && (
          <table className="t" style={{ marginTop: 12 }}>
            <thead><tr><th>Address</th><th>Events</th><th>Status</th><th /></tr></thead>
            <tbody>{hooks.map((h) => (
              <Fragment key={h.id}>
                <tr>
                  <td>{h.url}{h.description && <div className="muted">{h.description}</div>}</td>
                  <td>{h.events.length === events.length ? 'Everything' : h.events.map((x) => EVENT_LABEL[x] ?? x).join(', ')}</td>
                  <td>{h.active ? <span className="chip paid">On</span> : <span className="chip cancelled">Off</span>}{h.failed > 0 && <span className="muted"> {h.failed} failed</span>}
                    {!h.active && h.consecutive_failures >= 20 && <div className="muted">Switched off after repeated failures.</div>}
                    {tested[h.id] && <div className={tested[h.id]!.startsWith('Works') ? 'ok' : 'error'} role="status">{tested[h.id]}</div>}</td>
                  <td className="n">
                    <button className="link" disabled={busy} onClick={() => void run(async () => { const r = await api(`/api/outbound-webhooks/${h.id}/test`, { body: {} }); setTested({ ...tested, [h.id]: r.ok ? `Works: the server answered ${r.status}.` : `Did not work: ${r.error ?? 'no answer'}` }); })}>Send a test</button>{' '}
                    <button className="link" disabled={busy} onClick={() => void run(async () => { await api(`/api/outbound-webhooks/${h.id}`, { method: 'PATCH', body: { active: !h.active } }); await load(); })}>{h.active ? 'Turn off' : 'Turn on'}</button>{' '}
                    <button className="link" onClick={async () => { if (open === h.id) setOpen(null); else { setDeliveries((await api(`/api/outbound-webhooks/${h.id}/deliveries`)).deliveries); setOpen(h.id); } }}>{open === h.id ? 'Hide history' : 'History'}</button>{' '}
                    <button className="link" disabled={busy} onClick={() => { if (confirm('Delete this webhook and its history?')) void run(async () => { await api(`/api/outbound-webhooks/${h.id}`, { method: 'DELETE' }); await load(); }); }}>Delete</button>
                  </td>
                </tr>
                {open === h.id && (
                  <tr><td colSpan={4}>
                    {deliveries.length === 0 ? <span className="muted">Nothing sent yet.</span> : (
                      <table className="t"><thead><tr><th>When</th><th>Event</th><th>Result</th><th className="n">Tries</th></tr></thead>
                        <tbody>{deliveries.map((d) => (
                          <tr key={d.id}><td>{d.created_at.slice(0, 19).replace('T', ' ')}</td><td><code>{d.event_type}</code></td>
                            <td>{d.status === 'delivered' ? <span className="ok">Delivered ({d.response_status})</span> : d.status === 'pending' ? <span className="muted">Will retry{d.error ? `: ${d.error}` : ''}</span> : <span className="error">Failed: {d.error}</span>}</td><td className="n">{d.attempts}</td></tr>))}</tbody></table>)}
                  </td></tr>)}
              </Fragment>))}</tbody></table>)}
      </section>
    </>
  );
}
