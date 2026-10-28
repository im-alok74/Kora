'use client';
import { useEffect, useState } from 'react';
import { api, paiseToRupeeText } from '../lib/client';

type Cfg = { enabled: boolean; mode: 'percent_per_month' | 'flat'; value: number; graceDays: number; gstRateBp: number };
const RATES = [{ bp: 0, label: '0%' }, { bp: 500, label: '5%' }, { bp: 1200, label: '12%' }, { bp: 1800, label: '18%' }, { bp: 2800, label: '28%' }];

/** Late fee settings. Nothing is charged automatically: an overdue invoice offers a draft debit note that the owner issues. */
export default function LateFeeSettings({ readOnly }: { readOnly: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [text, setText] = useState('');      // the fee as typed: a percentage or rupees
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const show = (c: Cfg) => setText(c.mode === 'flat' ? paiseToRupeeText(c.value) : String(c.value / 100));
  useEffect(() => { api('/api/late-fees').then((r) => { setCfg(r.config); show(r.config); }).catch((e) => setErr(e.message)); }, []);
  if (!cfg) return err ? <p className="error" role="alert">{err}</p> : null;

  const save = async () => {
    setErr(''); setMsg('');
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0 || !/^\d+(\.\d{1,2})?$/.test(text.trim())) { setErr(cfg.mode === 'flat' ? 'Enter the fee in rupees, for example 250.' : 'Enter the percentage a month, for example 2 or 1.5.'); return; }
    try {
      const r = await api('/api/late-fees', { method: 'PUT', body: { ...cfg, value: Math.round(n * 100) } });
      setCfg(r.config); show(r.config); setMsg('Late fee settings saved.');
    } catch (x) { setErr((x as Error).message); }
  };

  return (
    <form className="panel" aria-label="Late fees" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2>Late fees</h2>
      <p className="muted">When an invoice is overdue, Kora works out the fee that has built up and offers a draft debit note. You read it and issue it. Nothing is charged automatically. A late fee can attract GST, so check the rate with your CA.</p>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Offer late fees on overdue invoices</label>
        <div className="row">
          <div><label htmlFor="lm">Charge</label>
            <select id="lm" value={cfg.mode} onChange={(e) => { const mode = e.target.value as Cfg['mode']; setCfg({ ...cfg, mode }); setText(mode === 'flat' ? '250' : '2'); }}>
              <option value="percent_per_month">A percentage of what is owed, per month</option><option value="flat">A flat amount, once</option></select></div>
          <div><label htmlFor="lv">{cfg.mode === 'flat' ? 'Fee (Rs)' : 'Percent per month'}</label><input id="lv" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div><label htmlFor="lg">Grace days after the due date</label><input id="lg" type="number" min={0} max={90} value={cfg.graceDays} onChange={(e) => setCfg({ ...cfg, graceDays: Number(e.target.value) })} /></div>
          <div><label htmlFor="lt">GST on the fee</label>
            <select id="lt" value={cfg.gstRateBp} onChange={(e) => setCfg({ ...cfg, gstRateBp: Number(e.target.value) })}>{RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></div>
        </div>
        <button>Save late fee settings</button>
      </fieldset>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
    </form>
  );
}
