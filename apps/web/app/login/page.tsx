'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';

export default function Login() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<'id' | 'code' | 'mfa'>('id');
  const [mfaToken, setMfaToken] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const me = await api('/api/me');
    window.location.href = me.businesses.length ? '/app' : '/setup';
  };
  useEffect(() => { api('/api/me').then(enter).catch(() => setReady(true)); }, []);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!ready) return <main className="auth"><p className="muted">Loading</p></main>;

  return (
    <main className="auth">
      <div className="auth-box">
      <div className="auth-brand"><a href="/" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a></div>
      <h1>Sign in to Kora</h1>
      <p className="lead">We send a six-digit code to your mobile number or email. No password to remember.</p>
      <div className="card">
        {step === 'id' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/request', { body: { identifier } }); setStep('code'); }); }}>
            <label htmlFor="id">Mobile number or email</label>
            <input id="id" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <button disabled={busy}>Send code</button>
          </form>
        ) : step === 'mfa' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/mfa', { body: { mfaToken, code } }); await enter(); }); }}>
            <label htmlFor="mfa">Code from your authenticator app, or a recovery code</label>
            <input id="mfa" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => { setStep('id'); setCode(''); }}>Start again</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api('/api/auth/verify', { body: { identifier, code } }); if (r.needsMfa) { setMfaToken(r.mfaToken); setCode(''); setStep('mfa'); return; } await enter(); }); }}>
            <label htmlFor="code">Six-digit code sent to {identifier}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => setStep('id')}>Use a different number</button>
          </form>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>Kora prepares your documents. You and your CA stay responsible for every invoice and filing. By signing in you agree to the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      </div>
    </main>
  );
}
