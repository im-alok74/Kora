'use client';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api } from '../../../lib/client';

type Session = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; mfa: boolean; current: boolean };
type Ev = { id: string; kind: string; ip: string | null; at: string; detail: Record<string, unknown> };
type Account = { user: { phone: string | null; email: string | null; name: string | null }; sessions: Session[]; events: Ev[]; mfa: { enabled: boolean; pending: boolean; recoveryCodesLeft: number } };

const KIND: Record<string, string> = {
  login: 'Signed in', 'login.code_ok_mfa_needed': 'Code accepted, waiting for the authenticator', 'login.mfa_failed': 'Wrong authenticator code',
  'session.revoked': 'A device was signed out', 'session.revoked_others': 'Other devices were signed out', 'mfa.enabled': 'Authenticator app turned on',
  'mfa.disabled': 'Authenticator app turned off', 'identifier.linked': 'A number or email was added',
};
/** "Chrome on Windows" from a user agent, good enough to recognise your own devices. */
const device = (ua: string | null) => {
  if (!ua) return 'Unknown device';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${b} on ${o}`;
};

/** The person's own sign-in: devices, the authenticator app, adding a number or email, and recent security events. */
export default function Security() {
  const [a, setA] = useState<Account | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [link, setLink] = useState({ identifier: '', code: '', sent: false });

  const load = useCallback(async () => { setA(await api('/api/account')); }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const act = async (body: Record<string, unknown>) => api('/api/account', { body });
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (!a) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;

  return (
    <>
      <div className="toolbar"><div><h1>Security</h1><p className="page-sub">Your devices, your sign-in methods and what happened on your account.</p></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      <div className="panel" aria-label="Authenticator app">
        <h2>Authenticator app</h2>
        {a.mfa.enabled ? (<>
          <p className="ok"><Icon name="shield" size={16} /> On. You will be asked for a code from your app every time you sign in. {a.mfa.recoveryCodesLeft} recovery {a.mfa.recoveryCodesLeft === 1 ? 'code is' : 'codes are'} left.</p>
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await act({ action: 'mfa.disable', code }); setCode(''); setMsg('Authenticator app turned off.'); await load(); }); }}>
            <label htmlFor="md">To turn it off, enter a current code or a recovery code</label>
            <input id="md" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
            <button className="danger" disabled={busy} style={{ marginTop: 10 }}>Turn off</button>
          </form></>
        ) : setup ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await act({ action: 'mfa.confirm', code }); setCodes(r.recoveryCodes); setSetup(null); setCode(''); await load(); }); }}>
            <p>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or any other).</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
            <p className="muted" style={{ fontSize: 13 }}>Cannot scan? Enter this key by hand: <code data-testid="mfa-secret">{setup.secret}</code></p>
            <label htmlFor="mc">The 6-digit code the app shows</label>
            <input id="mc" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
            <button disabled={busy} style={{ marginTop: 10 }}>Turn on</button>
          </form>
        ) : (<>
          <p className="muted">Adds a second step to signing in: a code from an app on your phone, on top of the code we send you.</p>
          <button disabled={busy} onClick={() => run(async () => { setSetup(await act({ action: 'mfa.begin' })); })}>Set up</button></>
        )}
        {codes && (
          <div className="panel" role="status" style={{ marginTop: 12 }} data-testid="recovery-codes">
            <b>Save these recovery codes now.</b>
            <p className="muted" style={{ fontSize: 13 }}>Each works once, if you lose your phone. They will not be shown again.</p>
            <pre style={{ margin: 0, fontSize: 15 }}>{codes.join('\n')}</pre>
          </div>)}
      </div>

      <div className="panel" aria-label="Sign-in methods">
        <h2>How you sign in</h2>
        <p>Mobile: <b>{a.user.phone ?? 'not added'}</b> · Email: <b>{a.user.email ?? 'not added'}</b></p>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          if (!link.sent) { await act({ action: 'identifier.request', identifier: link.identifier }); setLink({ ...link, sent: true }); setMsg('Code sent.'); }
          else { await act({ action: 'identifier.confirm', identifier: link.identifier, code: link.code }); setLink({ identifier: '', code: '', sent: false }); setMsg('Added. You can now sign in with it too.'); await load(); }
        }); }}>
          <div className="row">
            <div><label htmlFor="li" style={{ marginTop: 0 }}>Add a mobile number or email</label><input id="li" value={link.identifier} disabled={link.sent} onChange={(e) => setLink({ ...link, identifier: e.target.value })} required /></div>
            {link.sent && <div><label htmlFor="lc" style={{ marginTop: 0 }}>Code we sent</label><input id="lc" inputMode="numeric" maxLength={6} value={link.code} onChange={(e) => setLink({ ...link, code: e.target.value })} required /></div>}
          </div>
          <button disabled={busy} style={{ marginTop: 10 }}>{link.sent ? 'Confirm' : 'Send a code'}</button>
        </form>
      </div>

      <div className="panel" aria-label="Devices">
        <h2>Devices signed in</h2>
        <table className="t" aria-label="Sessions">
          <thead><tr><th>Device</th><th>Network</th><th>Last used</th><th /></tr></thead>
          <tbody>{a.sessions.map((s) => (
            <tr key={s.id}><td>{device(s.userAgent)}{s.current && <> <span className="chip paid">This device</span></>}{s.mfa && <> <span className="chip issued">Authenticator</span></>}</td>
              <td>{s.ip ?? ''}</td><td>{new Date(s.lastSeenAt).toLocaleString('en-IN')}</td>
              <td className="n">{!s.current && <button className="link" disabled={busy} onClick={() => run(async () => { await act({ action: 'session.revoke', sessionId: s.id }); await load(); })}>Sign out</button>}</td></tr>))}</tbody>
        </table>
        {a.sessions.length > 1 && <button className="secondary" disabled={busy} style={{ marginTop: 12 }} onClick={() => run(async () => { const r = await act({ action: 'session.revokeOthers' }); setMsg(`Signed out ${r.revoked} other ${r.revoked === 1 ? 'device' : 'devices'}.`); await load(); })}>Sign out everywhere else</button>}
      </div>

      <div className="panel" aria-label="Recent activity">
        <h2>Recent security activity</h2>
        {a.events.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="plain">{a.events.map((e) => (<li key={e.id}><span>{KIND[e.kind] ?? e.kind}{e.ip ? ` · ${e.ip}` : ''}</span><span className="muted">{new Date(e.at).toLocaleString('en-IN')}</span></li>))}</ul>)}
      </div>
    </>
  );
}
