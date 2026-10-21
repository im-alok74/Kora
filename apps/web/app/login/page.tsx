'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';
import Icon from '../../components/Icon';

type Mode = 'signin' | 'signup' | 'code';
type Step = 'id' | 'code' | 'mfa';
const TYPES: [string, string][] = [['business', 'A business (invoices, GST)'], ['ca', 'A CA or accounting firm'], ['lawyer', 'A lawyer or legal practice'], ['freelancer', 'A freelancer or agency']];
const LANDING: Record<string, string> = { ca: '/app/firm', lawyer: '/app/matters', freelancer: '/app/projects' };

export default function Login() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('id');
  const [mfaToken, setMfaToken] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('business');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const me = await api('/api/me');
    window.location.href = me.businesses.length ? (LANDING[me.accountType] ?? '/app') : '/setup';
  };
  useEffect(() => { api('/api/me').then(enter).catch(() => setReady(true)); }, []);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('signup')) setMode('signup'); }, []);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const after = async (r: { needsMfa?: boolean; mfaToken?: string }) => {
    if (r.needsMfa) { setMfaToken(r.mfaToken ?? ''); setCode(''); setStep('mfa'); return; }
    await enter();
  };
  const switchTo = (m: Mode) => { setMode(m); setStep('id'); setErr(''); setCode(''); };

  if (!ready) return <main className="auth"><p className="muted">Loading</p></main>;

  return (
    <main className="auth">
      <div className="auth-shell">
      <div className="auth-main">
      <div className="auth-box">
      <div className="auth-brand"><a href="/" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a></div>
      <h1>{mode === 'signup' ? 'Create your Kora account' : 'Sign in to Kora'}</h1>
      <p className="lead">{mode === 'code' ? 'We send a six-digit code to your mobile number or email.' : mode === 'signup' ? 'Use your email or mobile number and choose a password. Nothing to confirm.' : 'Use your email or mobile number and your password.'}</p>
      <div className="auth-form">
        {step === 'mfa' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/mfa', { body: { mfaToken, code } }); await enter(); }); }}>
            <label htmlFor="mfa">Code from your authenticator app, or a recovery code</label>
            <input id="mfa" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => switchTo('signin')}>Start again</button>
          </form>
        ) : mode === 'signin' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => after(await api('/api/auth/password', { body: { identifier, password } }))); }}>
            <label htmlFor="id">Mobile number or email</label>
            <input id="id" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button disabled={busy}>Sign in</button>
          </form>
        ) : mode === 'signup' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => after(await api('/api/auth/signup', { body: { identifier, password, name, accountType } }))); }}>
            <label htmlFor="nm">Your name</label>
            <input id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            <label htmlFor="at">I am</label>
            <select id="at" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label htmlFor="id">Mobile number or email</label>
            <input id="id" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <label htmlFor="pw">Password (at least 8 characters)</label>
            <input id="pw" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button disabled={busy}>Create account</button>
          </form>
        ) : step === 'id' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/request', { body: { identifier } }); setStep('code'); }); }}>
            <label htmlFor="id">Mobile number or email</label>
            <input id="id" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <button disabled={busy}>Send code</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => after(await api('/api/auth/verify', { body: { identifier, code } }))); }}>
            <label htmlFor="code">Six-digit code sent to {identifier}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => setStep('id')}>Use a different number</button>
          </form>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        {step !== 'mfa' && (
          <p className="muted" style={{ marginTop: 12, fontSize: 14 }}>
            {mode !== 'signin' && <><button type="button" className="link" onClick={() => switchTo('signin')}>Use a password instead</button>{' · '}</>}
            {mode !== 'signup' && <><button type="button" className="link" onClick={() => switchTo('signup')}>Create an account</button>{' · '}</>}
            {mode !== 'code' && <button type="button" className="link" onClick={() => switchTo('code')}>Use an emailed or texted code</button>}
          </p>
        )}
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>Kora prepares your documents. You and your CA stay responsible for every invoice and filing. By signing in you agree to the <a href="/terms">terms</a> and the <a href="/privacy">privacy policy</a>.</p>
      </div>
      </div>
      <aside className="auth-promo" aria-label="About Kora">
        <div className="promo-art" aria-hidden="true">
          <div className="pa-card">
            <div className="pa-top"><b>INV-0042</b><span className="chip paid">Paid</span></div>
            <i /><i /><i className="short" />
            <div className="pa-total"><span>Total</span><b>Rs 19,470.00</b></div>
          </div>
          <div className="pa-qr"><span className="l-qr" /></div>
          <div className="l-badge wa"><Icon name="chat" size={15} />Sent on WhatsApp</div>
        </div>
        <h2>Invoices that get paid</h2>
        <p>Tax worked out for you, a UPI QR on every invoice, and payments that match themselves.</p>
        <a className="pill" href="/#how">See how it works</a>
      </aside>
      </div>
    </main>
  );
}
