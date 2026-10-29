'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Consent = { purpose: string; label: string; text: string; required: boolean; given: boolean; since: string | null; needsRenewal: boolean };
type Req = { id: string; kind: string; details: string; status: string; due_at: string; resolution: string | null; created_at: string };
type Data = { noticeVersion: string; consents: Consent[]; requests: Req[] };

const KIND: Record<string, string> = {
  access: 'See what Kora holds about me', correction: 'Correct something about me', erasure: 'Erase my personal data',
  grievance: 'Make a complaint', nomination: 'Name someone to act for me',
};
const STATUS: Record<string, string> = { open: 'Open', in_progress: 'Being looked at', done: 'Done', rejected: 'Not possible' };
const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The person's own data rights under the DPDP Act: consent choices, a copy of their data, and requests Kora must answer. */
export default function Privacy() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('access');
  const [details, setDetails] = useState('');

  const load = useCallback(() => { api('/api/privacy').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); setMsg(ok); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!d) return <div className="muted" role="status">{err || 'Loading…'}</div>;
  return (
    <div>
      <h1>Privacy</h1>
      <p className="muted">Your choices about the personal data Kora holds about you, under India&rsquo;s Digital Personal Data Protection Act. Your customers&rsquo; and invoices&rsquo; data belongs to your business; export it from the <a href="/app/data">Data</a> page.</p>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <div className="panel" aria-label="Your choices">
        <h2>What you have agreed to</h2>
        <ul className="plain">
          {d.consents.map((c) => (
            <li key={c.purpose} style={{ marginBottom: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={c.given} disabled={busy || c.required}
                  onChange={(e) => void run(() => api('/api/privacy', { body: { action: 'consent.set', purpose: c.purpose, given: e.target.checked } }), 'Saved.')} />
                <span><b>{c.label}</b>{c.required && ' (needed)'}<br /><span className="muted">{c.text}{c.since ? ` Since ${day(c.since)}.` : ''}{c.needsRenewal ? ' The notice has changed since you agreed.' : ''}</span></span>
              </label>
            </li>
          ))}
        </ul>
        <p className="muted">Notice version {d.noticeVersion}. Read the <a href="/privacy">privacy notice</a> and the <a href="/terms">terms</a>.</p>
      </div>

      <div className="panel" aria-label="Your data">
        <h2>A copy of your data</h2>
        <p className="muted">Your profile, the businesses you belong to, signed-in devices, the security log, your consents and your requests, as a file.</p>
        <a className="btn secondary" href="/api/privacy?export=1" download>Download my data</a>
      </div>

      <div className="panel" aria-label="Make a request">
        <h2>Ask us to do something</h2>
        <p className="muted">We answer within 30 days. To close your account yourself, go to <a href="/app/security">Security</a>.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/privacy', { body: { action: 'request.open', kind, details } }); setDetails(''); }, 'Request received. You can follow it below.'); }}>
          <label htmlFor="pk">What is it about</label>
          <select id="pk" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label htmlFor="pd">Details {kind === 'access' || kind === 'erasure' ? '(optional)' : ''}</label>
          <textarea id="pd" rows={4} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
          <button disabled={busy} style={{ marginTop: 10 }}>Send request</button>
        </form>
      </div>

      <div className="panel" aria-label="Your requests">
        <h2>Your requests</h2>
        {d.requests.length === 0 ? <p className="muted">None yet.</p> : (
          <table className="t"><thead><tr><th>Request</th><th>Sent</th><th>Answer due</th><th>Status</th></tr></thead>
            <tbody>{d.requests.map((r) => (
              <tr key={r.id}><td>{KIND[r.kind] ?? r.kind}{r.resolution ? <div className="muted">{r.resolution}</div> : null}</td><td>{day(r.created_at)}</td><td>{day(r.due_at)}</td><td>{STATUS[r.status] ?? r.status}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </div>
  );
}
