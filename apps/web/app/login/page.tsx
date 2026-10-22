'use client';
// Sign in with a password (no address check), create an account, or use an emailed or texted code.
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';
import { passwordStrength } from '../../lib/passwordStrength';
import { identifierProblem } from '../../lib/identifierCheck';
import Icon from '../../components/Icon';
import '../wizard.css';

type Mode = 'signin' | 'signup' | 'code';
type Step = 'id' | 'code' | 'mfa';
const TYPES: [string, string][] = [['business', 'A business (invoices, GST)'], ['ca', 'A CA or accounting firm'], ['lawyer', 'A lawyer or legal practice'], ['freelancer', 'A freelancer or agency']];
const LANDING: Record<string, string> = { ca: '/app/firm', lawyer: '/app/matters', freelancer: '/app/projects' };

// What we remember on this device, so a returning person is not asked twice. Never a password or a code.
const remember = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ''; localStorage.setItem(k, v); } catch { /* storage may be blocked */ } return ''; };

export default function Login() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('id');
  const [mfaToken, setMfaToken] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('business');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [idErr, setIdErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  const enter = async () => {
    if (demo || new URLSearchParams(window.location.search).has('demo')) { try { await api('/api/demo', { body: {} }); window.location.href = '/app'; return; } catch { /* fall through to the normal route */ } }
    const me = await api('/api/me');
    window.location.href = me.businesses.length ? (LANDING[me.accountType] ?? '/app') : '/setup';
  };
  useEffect(() => { api('/api/me').then(enter).catch(() => setReady(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('demo')) setDemo(true);
    const saved = remember('kora-account-type');
    if (saved && TYPES.some(([k]) => k === saved)) setAccountType(saved);
    const last = remember('kora-last-mode');
    if (q.has('signup')) setMode('signup');
    else if (last === 'code' || last === 'signin') setMode(last);
    const who = remember('kora-last-identifier');
    if (who && !q.has('signup')) setIdentifier(who);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const checkId = () => { const p = identifierProblem(identifier); setIdErr(p); return !p; };
  const after = async (r: { needsMfa?: boolean; mfaToken?: string }, how: Mode) => {
    if (r.needsMfa) { setMfaToken(r.mfaToken ?? ''); setCode(''); setStep('mfa'); return; }
    remember('kora-last-mode', how === 'signup' ? 'signin' : how);
    remember('kora-last-identifier', identifier.trim());
    await enter();
  };
  const switchTo = (m: Mode) => { setMode(m); setStep('id'); setErr(''); setIdErr(''); setCode(''); };
  const strength = passwordStrength(password, [identifier, name]);

  if (!ready) return <main className="auth"><p className="muted" role="status">Loading your account…</p></main>;

  const idField = (
    <>
      <label htmlFor="id">Mobile number or email</label>
      <input id="id" autoComplete="username" value={identifier} onChange={(e) => { setIdentifier(e.target.value); if (idErr) setIdErr(''); }} onBlur={() => { if (identifier) checkId(); }}
        aria-invalid={!!idErr} aria-describedby={idErr ? 'id-err' : undefined} required />
      {idErr && <p id="id-err" className="error" role="alert">{idErr}</p>}
    </>
  );
  const pwToggle = <button type="button" className="link show-pw" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>;

  return (
    <main className="auth">
      <div className="auth-shell">
      <div className="auth-main">
      <div className="auth-box">
      <div className="auth-brand"><a href="/" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a></div>
      <div className="auth-mode" aria-label="Account access">
        <button type="button" aria-pressed={mode !== 'signup'} onClick={() => switchTo('signin')}>Sign in</button>
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => switchTo('signup')}>Create account</button>
      </div>
      <h1>{mode === 'signup' ? 'Create your Kora account' : 'Sign in to Kora'}</h1>
      <p className="lead">{mode === 'code' ? 'Receive a sign-in code by email or text message.' : mode === 'signup' ? (demo ? 'Create an account to explore a labelled demo business with sample data.' : 'Create an account to manage your invoices and payments.') : 'Access your invoices, customers, and payments.'}</p>
      <div className="auth-form" key={`${mode}-${step}`} aria-busy={busy}>
        {step === 'mfa' ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/mfa', { body: { mfaToken, code } }); remember('kora-last-identifier', identifier.trim()); await enter(); }); }}>
            <label htmlFor="mfa">Code from your authenticator app, or a recovery code</label>
            <input id="mfa" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <button disabled={busy}>Sign in</button>{' '}
            <button type="button" className="link" onClick={() => switchTo('signin')}>Start again</button>
          </form>
        ) : mode === 'signin' ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (!checkId()) return; void run(async () => after(await api('/api/auth/password', { body: { identifier, password } }), 'signin')); }}>
            {idField}
            <label htmlFor="pw">Password</label>
            <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {pwToggle}
            <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        ) : mode === 'signup' ? (
          <form noValidate onSubmit={(e) => {
            e.preventDefault();
            if (!checkId()) return;
            if (!strength.ok) { setErr(password.length < 8 ? 'Your password needs at least 8 characters.' : strength.tip); return; }
            void run(async () => { remember('kora-account-type', accountType); await after(await api('/api/auth/signup', { body: { identifier, password, name, accountType } }), 'signup'); });
          }}>
            <label htmlFor="nm">Your name</label>
            <input id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            <label htmlFor="at">I am</label>
            <select id="at" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {idField}
            <label htmlFor="pw">Password (at least 8 characters)</label>
            <input id="pw" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-note" required />
            <div className="pw-meter" data-score={strength.score} aria-hidden="true"><i /><i /><i /><i /></div>
            <p id="pw-note" className="pw-note" role="status">{password ? <><b>{strength.label}.</b> {strength.tip}</> : 'Use at least 8 characters. A few random words work well.'}</p>
            {pwToggle}
            <button disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
          </form>
        ) : step === 'id' ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (!checkId()) return; void run(async () => { await api('/api/auth/request', { body: { identifier } }); setStep('code'); }); }}>
            {idField}
            <button disabled={busy}>Send code</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => after(await api('/api/auth/verify', { body: { identifier, code } }), 'code')); }}>
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
        <p className="auth-sample-label">Illustrative invoice</p>
        <h2>Your business, in one place</h2>
        <p>Create GST invoices, keep track of customer balances, and prepare reports for your CA.</p>
        <ul className="auth-benefits"><li><Icon name="invoice" size={18} />Professional invoice templates</li><li><Icon name="rupee" size={18} />Payment and expense tracking</li><li><Icon name="chart" size={18} />Reports ready when you need them</li></ul>
        <a className="auth-product-link" href="/#product-preview">Explore Kora <Icon name="arrow" size={16} /></a>
      </aside>
      </div>
    </main>
  );
}
