'use client';
import KoraLogo from '../../components/KoraLogo';

import { useEffect, useRef, useState } from 'react';
import { gstinValid, STATE_NAMES } from '@kora/tax';
import { api } from '../../lib/client';
import ClientOnly from '../../components/ClientOnly';
import Icon from '../../components/Icon';
import '../wizard.css';

export default function Setup() {
  return <ClientOnly><SetupForm /></ClientOnly>;
}

type Check = { state: 'idle' | 'checking' | 'ok' | 'bad'; text: string };

function SetupForm() {
  const [legalName, setLegalName] = useState('');
  const [registrationType, setType] = useState('regular');
  const [gstin, setGstin] = useState('');
  const [stateCode, setState] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle', text: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nameTouched = useRef(false);

  const registered = registrationType !== 'unregistered';
  const g = gstin.trim().toUpperCase();
  const stateFromGstin = registered && g.length >= 2 && /^[0-9]{2}/.test(g) && STATE_NAMES[g.slice(0, 2)] ? g.slice(0, 2) : '';
  const state = stateFromGstin || stateCode;

  // Check the GSTIN as soon as it is 15 characters long, and fill the state (and the name, when the GST partner supplies it).
  useEffect(() => {
    if (!registered || g.length < 15) { setCheck({ state: 'idle', text: '' }); return; }
    if (!gstinValid(g)) { setCheck({ state: 'bad', text: 'This GSTIN is not valid. Check the last character.' }); return; }
    setCheck({ state: 'checking', text: 'Checking' });
    let live = true;
    api(`/api/gstin-check/${g}`).then((r) => {
      if (!live) return;
      const info = r.info as { stateCode?: string; legalName?: string; tradeName?: string } | null;
      if (!r.valid) { setCheck({ state: 'bad', text: r.reason ?? 'This GSTIN is not valid.' }); return; }
      const name = info?.legalName;
      if (name && !nameTouched.current) setLegalName(name);
      const st = STATE_NAMES[info?.stateCode ?? g.slice(0, 2)];
      setCheck({ state: 'ok', text: name ? `GSTIN is valid. Name and state filled in: ${name}, ${st}.` : `GSTIN is valid. State filled in: ${st}. Enter the business name as it is registered.` });
    }).catch(() => { if (live) setCheck({ state: 'ok', text: 'The GSTIN format is valid. We could not look it up just now, and that is fine.' }); });
    return () => { live = false; };
  }, [g, registered]);

  return (
    <div className="setup-bg">
    <main className="setup">
      <a className="auth-brand-link" href="/" aria-label="Kora home"><KoraLogo /></a>
      <p className="wiz-progress" role="img" aria-label="Step 1 of 5"><span className="on" /><span /><span /><span /><span /></p>
      <h1>Set up your <span className="hl">business</span></h1>
      <p className="muted">Step 1 of 5. This is printed on every invoice. Next you can add your logo, a customer and your first invoice, and skip anything you like.</p>
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try {
          const r = await api('/api/businesses', { body: { legalName, registrationType, gstin: registered ? g : undefined, stateCode: state } });
          await api('/api/business/select', { body: { businessId: r.businessId } });
          window.location.href = '/app/welcome';
        } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <label htmlFor="ln">Legal name of the business</label>
        <div className="field"><Icon name="briefcase" size={18} /><input id="ln" value={legalName} onChange={(e) => { nameTouched.current = true; setLegalName(e.target.value); }} required /></div>
        <label htmlFor="rt">GST registration</label>
        <div className="field"><Icon name="percent" size={18} /><select id="rt" value={registrationType} onChange={(e) => setType(e.target.value)}>
          <option value="regular">Registered (regular)</option>
          <option value="composition">Registered (composition scheme)</option>
          <option value="unregistered">Not registered for GST</option>
        </select></div>
        {registered && (<>
          <label htmlFor="gs">GSTIN</label>
          <div className="field"><Icon name="invoice" size={18} /><input id="gs" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} required autoComplete="off" aria-describedby="gs-note" aria-invalid={check.state === 'bad'} /></div>
          <p id="gs-note" className={`gs-note ${check.state}`} role="status">{check.text || 'Fifteen characters, like 27AAPFU0939F1ZV.'}</p>
        </>)}
        <label htmlFor="st">State</label>
        <div className="field"><Icon name="home" size={18} /><select id="st" value={state} onChange={(e) => setState(e.target.value)} disabled={!!stateFromGstin} required>
          <option value="">Choose a state</option>
          {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select></div>
        <button disabled={busy}>Create business</button>
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <p className="muted setup-demo">Just looking around? <button type="button" className="link" disabled={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/api/demo', { body: {} }); window.location.href = '/app'; } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>Try it with sample data</button>. It makes a clearly labelled demo business that you can remove in one click.</p>
    </main>
    </div>
  );
}
