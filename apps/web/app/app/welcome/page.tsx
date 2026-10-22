'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useCallback, useEffect, useState } from 'react';
import { STATE_NAMES } from '@kora/tax';
import { api } from '../../../lib/client';
import '../../wizard.css';

type Key = 'business' | 'logo' | 'look' | 'customer' | 'invoice';
type StepState = 'done' | 'skipped' | 'todo';
type Onb = { steps: { key: Key; state: StepState }[]; next: Key | null; finished: boolean };
type Biz = { legal_name: string; trade_name: string | null; gstin: string | null; state_code: string; address: Record<string, string>; phone: string | null; email: string | null; upi_vpa: string | null; bank_details: Record<string, string> };
type Tpl = { accent: string; layout: string; logoDataUrl: string | null; [k: string]: unknown };

const TITLES: Record<Key, string> = { business: 'Business details', logo: 'Your logo', look: 'Invoice look', customer: 'First customer', invoice: 'First invoice' };
const LAYOUTS: [string, string][] = [['classic', 'Classic'], ['modern', 'Modern'], ['minimal', 'Minimal'], ['compact', 'Compact']];
const COLOURS = ['#106cd9', '#0b5d4f', '#7c2130', '#6a3fb5', '#b45309', '#1f2937'];

export default function Welcome() {
  const [onb, setOnb] = useState<Onb | null>(null);
  const [biz, setBiz] = useState<Biz | null>(null);
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [cur, setCur] = useState<Key>('business');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (jump = false) => {
    const [o, b, t] = await Promise.all([api('/api/onboarding'), api('/api/business'), api('/api/template')]);
    setOnb(o.onboarding); setBiz(b.business); setTpl(t.template);
    if (jump) setCur(o.onboarding.next ?? 'invoice');
  }, []);
  useEffect(() => { refresh(true).catch((e) => setErr(e.message)); }, [refresh]);

  const mark = async (step: Key, state: StepState, then?: Key) => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/onboarding', { method: 'PUT', body: { step, state } });
      setOnb(r.onboarding);
      if (then) setCur(then);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (err && !onb) return <p className="error" role="alert">{err}</p>;
  if (!onb || !biz || !tpl) return <KoraLoader />;

  const doneCount = onb.steps.filter((s) => s.state !== 'todo').length;
  const stateOf = (k: Key) => onb.steps.find((s) => s.key === k)!.state;

  return (
    <div className="welcome">
      <h1>Welcome to Kora</h1>
      <p className="muted">Five short steps to your first invoice. Skip any of them. Everything you do here is saved, so you can leave and come back.</p>
      <div className="wiz-bar" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={5} aria-valuenow={doneCount}><i style={{ width: `${(doneCount / 5) * 100}%` }} /></div>
      <ol className="wiz-steps" aria-label="Steps">
        {(Object.keys(TITLES) as Key[]).map((k, i) => (
          <li key={k}><button type="button" aria-current={cur === k ? 'step' : undefined} onClick={() => setCur(k)}>
            {stateOf(k) === 'done' ? <span className="tick" aria-hidden="true">✓</span> : stateOf(k) === 'skipped' ? <span className="skip" aria-hidden="true">–</span> : null}
            {i + 1}. {TITLES[k]}<span className="sr-only">{stateOf(k) === 'done' ? ' (done)' : stateOf(k) === 'skipped' ? ' (skipped)' : ''}</span>
          </button></li>
        ))}
      </ol>
      {err && <p className="error" role="alert">{err}</p>}

      <section className="wiz-card" aria-labelledby="wiz-h">
        <h2 id="wiz-h">{TITLES[cur]}</h2>

        {cur === 'business' && <BusinessStep biz={biz} busy={busy} onSave={(patch) => run(async () => { await api('/api/business', { method: 'PUT', body: patch }); await refresh(); await mark('business', 'done', 'logo'); })} onSkip={() => mark('business', 'skipped', 'logo')} />}

        {cur === 'logo' && (
          <>
            <p className="muted">Printed at the top of every invoice. A PNG or JPEG under 150 KB.</p>
            <label htmlFor="logo">Choose a logo</label>
            <input id="logo" type="file" accept="image/png,image/jpeg" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              if (f.size > 150 * 1024) { setErr('The logo must be under 150 KB.'); return; }
              const r = new FileReader();
              r.onload = () => run(async () => { const res = await api('/api/template', { method: 'PUT', body: { ...tpl, logoDataUrl: String(r.result) } }); setTpl(res.template); await refresh(); });
              r.readAsDataURL(f);
            }} />
            {tpl.logoDataUrl && <img className="logo-preview" src={tpl.logoDataUrl} alt="Your logo" />}
            <div className="wiz-actions">
              <button type="button" disabled={busy || !tpl.logoDataUrl} onClick={() => setCur('look')}>Continue</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => mark('logo', 'skipped', 'look')}>Skip for now</button>
            </div>
          </>
        )}

        {cur === 'look' && <LookStep tpl={tpl} busy={busy} onSave={(next) => run(async () => { const res = await api('/api/template', { method: 'PUT', body: { ...tpl, ...next } }); setTpl(res.template); await mark('look', 'done', 'customer'); })} onSkip={() => mark('look', 'skipped', 'customer')} />}

        {cur === 'customer' && <CustomerStep busy={busy} done={stateOf('customer') === 'done'} onSave={(body) => run(async () => { await api('/api/parties', { body }); await refresh(); setCur('invoice'); })} onSkip={() => mark('customer', 'skipped', 'invoice')} />}

        {cur === 'invoice' && (
          <>
            <p>{stateOf('invoice') === 'done' ? 'You have made your first invoice. Nicely done.' : 'Tax is worked out as you type, and you can send the invoice on WhatsApp, SMS or email with a UPI QR.'}</p>
            <div className="wiz-actions">
              <a className="btn" href="/app/invoices/new">{stateOf('invoice') === 'done' ? 'Make another invoice' : 'Create your first invoice'}</a>
              <a className="btn secondary" href="/app">{doneCount >= 4 ? 'Go to your dashboard' : 'Skip to my dashboard'}</a>
            </div>
            <p className="muted" style={{ marginTop: 16 }}>Moving from other software? <a href="/app/import">Import your customers, items and invoices</a>. Need a hand? <a href="/help">Open the help centre</a>.</p>
          </>
        )}
      </section>
      {cur !== 'invoice' && <p className="muted" style={{ marginTop: 14 }}><a href="/app/invoices/new">Skip setup and make an invoice now</a> · <a href="/app">Go to the dashboard</a></p>}
    </div>
  );
}

function BusinessStep({ biz, busy, onSave, onSkip }: { biz: Biz; busy: boolean; onSave: (p: unknown) => void; onSkip: () => void }) {
  const a = biz.address ?? {};
  const [line1, setLine1] = useState(a.line1 ?? ''), [city, setCity] = useState(a.city ?? ''), [pincode, setPin] = useState(a.pincode ?? '');
  const [phone, setPhone] = useState(biz.phone ?? ''), [upi, setUpi] = useState(biz.upi_vpa ?? '');
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({ legalName: biz.legal_name, tradeName: biz.trade_name, address: { ...a, line1, city, pincode }, phone: phone || null, email: biz.email, upiVpa: upi || null, bank: { accountName: biz.bank_details?.accountName, accountNumber: biz.bank_details?.accountNumber, ifsc: biz.bank_details?.ifsc, bankName: biz.bank_details?.bankName } });
    }}>
      <p className="muted">{biz.legal_name}{biz.gstin ? ` · ${biz.gstin}` : ''} · {STATE_NAMES[biz.state_code]}. Add where you are and how to pay you. These print on every invoice.</p>
      <div className="wiz-grid">
        <div><label htmlFor="a1">Address</label><input id="a1" value={line1} onChange={(e) => setLine1(e.target.value)} autoComplete="street-address" /></div>
        <div><label htmlFor="ci">City</label><input id="ci" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" /></div>
        <div><label htmlFor="pc">Pincode</label><input id="pc" value={pincode} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="postal-code" /></div>
        <div><label htmlFor="ph">Business phone</label><input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
      </div>
      <label htmlFor="up">UPI ID (so every invoice carries a QR)</label>
      <input id="up" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" autoCapitalize="none" />
      <div className="wiz-actions"><button disabled={busy}>Save and continue</button><button type="button" className="secondary" disabled={busy} onClick={onSkip}>Skip for now</button></div>
    </form>
  );
}

function LookStep({ tpl, busy, onSave, onSkip }: { tpl: Tpl; busy: boolean; onSave: (n: Partial<Tpl>) => void; onSkip: () => void }) {
  const [layout, setLayout] = useState(tpl.layout), [accent, setAccent] = useState(tpl.accent);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ layout, accent }); }}>
      <p className="muted">Pick a layout and a colour. You can change these any time in Settings.</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="sr-only">Layout</legend>
        <div className="looks" style={{ ['--look-accent' as string]: accent }}>
          {LAYOUTS.map(([v, l]) => <label key={v} className="look" style={{ margin: 0 }}><input type="radio" name="layout" value={v} checked={layout === v} onChange={() => setLayout(v)} /><span className="thumb" />{l}</label>)}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}><legend style={{ fontSize: 13, fontWeight: 600 }}>Colour</legend>
        <div className="looks" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          {COLOURS.map((c) => <label key={c} className="look" style={{ margin: 0, padding: 8 }}><input type="radio" name="accent" value={c} checked={accent === c} onChange={() => setAccent(c)} /><span className="thumb" style={{ background: c, height: 28, marginBottom: 0 }} /><span className="sr-only">{c}</span></label>)}
        </div>
      </fieldset>
      <div className="wiz-actions"><button disabled={busy}>Save and continue</button><button type="button" className="secondary" disabled={busy} onClick={onSkip}>Skip for now</button></div>
    </form>
  );
}

function CustomerStep({ busy, done, onSave, onSkip }: { busy: boolean; done: boolean; onSave: (b: unknown) => void; onSkip: () => void }) {
  const [name, setName] = useState(''), [state, setState] = useState(''), [phone, setPhone] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ kind: 'customer', name, stateCode: state, phone: phone || null }); }}>
      <p className="muted">{done ? 'You already have a customer. Add another, or move on.' : 'Who do you bill most often? Add them once and pick them on every invoice. You can add a GSTIN later.'}</p>
      <label htmlFor="cn">Customer name</label>
      <input id="cn" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="wiz-grid">
        <div><label htmlFor="cs">State</label><select id="cs" value={state} onChange={(e) => setState(e.target.value)} required>
          <option value="">Choose a state</option>
          {Object.entries(STATE_NAMES).filter(([c]) => !['96', '97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select></div>
        <div><label htmlFor="cp">Mobile (optional)</label><input id="cp" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
      </div>
      <div className="wiz-actions"><button disabled={busy}>Add customer and continue</button><button type="button" className="secondary" disabled={busy} onClick={onSkip}>{done ? 'Continue' : 'Skip for now'}</button></div>
    </form>
  );
}
