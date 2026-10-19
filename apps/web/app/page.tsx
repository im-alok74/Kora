'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';

export default function Home() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<'id' | 'code'>('id');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const me = await api('/api/me');
    window.location.href = me.businesses.length ? '/app/invoices' : '/setup';
  };
  useEffect(() => { api('/api/me').then(enter).catch(() => setReady(true)); }, []);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!ready) return <main><p className="muted">Loading</p></main>;

  return (
    <main>
      <h1>Sign in to Kora</h1>
      <p className="muted">We send a six-digit code to your mobile number or email.</p>
      <div className="card">
        {step === 'id' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/request', { body: { identifier } }); setStep('code'); }); }}>
            <label htmlFor="id">Mobile number or email</label>
            <input id="id" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <button disabled={busy}>Send code</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/verify', { body: { identifier, code } }); await enter(); }); }}>
            <label htmlFor="code">Six-digit code sent to {identifier}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => setStep('id')}>Use a different number</button>
          </form>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </main>
  );
}
