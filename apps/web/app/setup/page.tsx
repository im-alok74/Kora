'use client';
import { useState } from 'react';
import { gstinValid, STATE_NAMES } from '@kora/tax';
import { api } from '../../lib/client';
import ClientOnly from '../../components/ClientOnly';

export default function Setup() {
  return <ClientOnly><SetupForm /></ClientOnly>;
}

function SetupForm() {
  const [legalName, setLegalName] = useState('');
  const [registrationType, setType] = useState('regular');
  const [gstin, setGstin] = useState('');
  const [stateCode, setState] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const registered = registrationType !== 'unregistered';
  const g = gstin.trim().toUpperCase();
  const stateFromGstin = registered && g.length >= 2 && /^[0-9]{2}/.test(g) && STATE_NAMES[g.slice(0, 2)] ? g.slice(0, 2) : '';
  const state = stateFromGstin || stateCode;

  return (
    <main>
      <h1>Set up your business</h1>
      <p className="muted">This is printed on every invoice. You can add your address and bank details later in Settings.</p>
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try {
          const r = await api('/api/businesses', { body: { legalName, registrationType, gstin: registered ? g : undefined, stateCode: state } });
          await api('/api/business/select', { body: { businessId: r.businessId } });
          window.location.href = '/app/invoices/new';
        } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <label htmlFor="ln">Legal name of the business</label>
        <input id="ln" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
        <label htmlFor="rt">GST registration</label>
        <select id="rt" value={registrationType} onChange={(e) => setType(e.target.value)}>
          <option value="regular">Registered (regular)</option>
          <option value="composition">Registered (composition scheme)</option>
          <option value="unregistered">Not registered for GST</option>
        </select>
        {registered && (<>
          <label htmlFor="gs">GSTIN</label>
          <input id="gs" value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} required />
          {g.length === 15 && !gstinValid(g) && <p className="error">This GSTIN is not valid. Check the last character.</p>}
        </>)}
        <label htmlFor="st">State</label>
        <select id="st" value={state} onChange={(e) => setState(e.target.value)} disabled={!!stateFromGstin} required>
          <option value="">Choose a state</option>
          {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <button disabled={busy}>Create business</button>
        {err && <p className="error" role="alert">{err}</p>}
      </form>
    </main>
  );
}
