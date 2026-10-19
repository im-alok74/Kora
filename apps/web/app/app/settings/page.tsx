'use client';
import LateFeeSettings from '../../../components/LateFeeSettings';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Rem = { enabled: boolean; channel: string; offsets: number[] };
type Tpl = { accent: string; font: string; layout: string; paper: string; logoDataUrl: string | null; showBank: boolean; showTerms: boolean;
  showNotes: boolean; showSignature: boolean; showAmountInWords: boolean; showUpiQr: boolean; footerText: string };

export default function Settings() {
  const [role, setRole] = useState('');
  const [p, setP] = useState({ legalName: '', tradeName: '', gstin: '', line1: '', line2: '', city: '', pincode: '', phone: '', email: '', upiVpa: '',
    accountName: '', accountNumber: '', ifsc: '', bankName: '', turnoverBand: 'under_5cr', einvoiceEnabled: false, crossedThreshold: false });
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [rem, setRem] = useState<Rem | null>(null);
  const [offsetsText, setOffsetsText] = useState('');
  const [locked, setLocked] = useState<string[]>([]);
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/business').then(({ business: b, role: r }) => {
      setRole(r);
      setP({ legalName: b.legal_name, tradeName: b.trade_name ?? '', gstin: b.gstin ?? '', line1: b.address?.line1 ?? '', line2: b.address?.line2 ?? '', city: b.address?.city ?? '',
        pincode: b.address?.pincode ?? '', phone: b.phone ?? '', email: b.email ?? '', upiVpa: b.upi_vpa ?? '', accountName: b.bank_details?.accountName ?? '',
        accountNumber: b.bank_details?.accountNumber ?? '', ifsc: b.bank_details?.ifsc ?? '', bankName: b.bank_details?.bankName ?? '', turnoverBand: b.turnover_band,
        einvoiceEnabled: !!b.einvoice_enabled, crossedThreshold: !!b.crossed_einvoice_threshold });
    });
    api('/api/template').then((r) => { setTpl(r.template); setLocked(r.locked); });
    api('/api/reminders').then((r) => { setRem(r.config); setOffsetsText(r.config.offsets.join(', ')); });
  }, []);

  useEffect(() => {
    if (!tpl) return;
    const h = setTimeout(() => api('/api/template/preview', { body: tpl }).then((r) => setPreview(r.html)).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(h);
  }, [tpl]);

  const readOnly = role !== 'owner';
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value });
  const setT = (patch: Partial<Tpl>) => tpl && setTpl({ ...tpl, ...patch });

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api('/api/business', { method: 'PUT', body: { legalName: p.legalName, tradeName: p.tradeName || null, gstin: p.gstin || null,
        address: { line1: p.line1, line2: p.line2, city: p.city, pincode: p.pincode }, phone: p.phone || null, email: p.email || null, upiVpa: p.upiVpa || null,
        bank: { accountName: p.accountName, accountNumber: p.accountNumber, ifsc: p.ifsc, bankName: p.bankName }, turnoverBand: p.turnoverBand,
        einvoiceEnabled: p.einvoiceEnabled, crossedThreshold: p.crossedThreshold } });
      setMsg('Business details saved.');
    } catch (x) { setErr((x as Error).message); }
  };

  const onLogo = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setT({ logoDataUrl: String(r.result) });
    r.readAsDataURL(f);
  };

  return (
    <>
      <h1>Settings</h1>
      {readOnly && <p className="muted">Only the owner can change settings.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      <form className="panel" onSubmit={saveProfile}>
        <h2>Business details</h2>
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="row">
            <div><label htmlFor="bl">Legal name</label><input id="bl" value={p.legalName} onChange={set('legalName')} required /></div>
            <div><label htmlFor="bt">Trade name</label><input id="bt" value={p.tradeName} onChange={set('tradeName')} /></div>
            <div><label htmlFor="bg">GSTIN</label><input id="bg" maxLength={15} value={p.gstin} onChange={set('gstin')} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="a1">Address line 1</label><input id="a1" value={p.line1} onChange={set('line1')} /></div>
            <div><label htmlFor="a2">Address line 2</label><input id="a2" value={p.line2} onChange={set('line2')} /></div>
            <div><label htmlFor="ac">City</label><input id="ac" value={p.city} onChange={set('city')} /></div>
            <div><label htmlFor="ap">Pincode</label><input id="ap" value={p.pincode} onChange={set('pincode')} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="ph">Phone</label><input id="ph" value={p.phone} onChange={set('phone')} /></div>
            <div><label htmlFor="em">Email</label><input id="em" value={p.email} onChange={set('email')} /></div>
            <div><label htmlFor="tb">Annual turnover</label>
              <select id="tb" value={p.turnoverBand} onChange={set('turnoverBand')}><option value="under_5cr">Up to Rs 5 crore</option><option value="over_5cr">Over Rs 5 crore</option></select></div>
          </div>
          <h3 style={{ marginTop: 16 }}>E-invoicing</h3>
          <p className="muted">E-invoicing is required once turnover has crossed Rs 5 crore in any year since 2017-18, even if it later fell. Kora registers each invoice to a registered business with the GST portal through a partner and prints the IRN and QR. Turn it on only if it applies to you, and check with your CA.</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={p.crossedThreshold} onChange={(e) => setP({ ...p, crossedThreshold: e.target.checked })} /> My turnover has been above Rs 5 crore in any year since 2017-18</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={p.einvoiceEnabled} onChange={(e) => setP({ ...p, einvoiceEnabled: e.target.checked })} /> Register my invoices as e-invoices</label>
          {p.crossedThreshold && !p.einvoiceEnabled && <p className="warn">Your answer says e-invoicing applies to you. Turn it on above, or confirm with your CA that it does not.</p>}
          <h3 style={{ marginTop: 16 }}>Payment details printed on invoices</h3>
          <div className="row">
            <div><label htmlFor="up">UPI ID</label><input id="up" placeholder="name@bank" value={p.upiVpa} onChange={set('upiVpa')} /></div>
            <div><label htmlFor="an">Account name</label><input id="an" value={p.accountName} onChange={set('accountName')} /></div>
            <div><label htmlFor="ano">Account number</label><input id="ano" value={p.accountNumber} onChange={set('accountNumber')} /></div>
            <div><label htmlFor="if">IFSC</label><input id="if" value={p.ifsc} onChange={set('ifsc')} /></div>
            <div><label htmlFor="bn">Bank</label><input id="bn" value={p.bankName} onChange={set('bankName')} /></div>
          </div>
          <button>Save business details</button>
        </fieldset>
      </form>

      {rem && (
        <form className="panel" onSubmit={async (e) => {
          e.preventDefault(); setErr(''); setMsg('');
          try {
            const offsets = offsetsText.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
            const r = await api('/api/reminders', { method: 'PUT', body: { ...rem, offsets } });
            setRem(r.config); setOffsetsText(r.config.offsets.join(', ')); setMsg('Reminder settings saved.');
          } catch (x) { setErr((x as Error).message); }
        }}>
          <h2>Payment reminders</h2>
          <p className="muted">Sent automatically for unpaid invoices at 10 am, counted in days from the due date. Use a minus for before the due date.</p>
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={rem.enabled} onChange={(e) => setRem({ ...rem, enabled: e.target.checked })} /> Send reminders automatically</label>
            <div className="row">
              <div><label htmlFor="rc">Send by</label><select id="rc" value={rem.channel} onChange={(e) => setRem({ ...rem, channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></div>
              <div><label htmlFor="ro">Days from due date</label><input id="ro" value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} placeholder="-2, 3, 7" /></div>
            </div>
            <button>Save reminder settings</button>
          </fieldset>
        </form>
      )}

      <LateFeeSettings readOnly={readOnly} />

      {tpl && (
        <div className="panel">
          <h2>Invoice template</h2>
          <div className="grid2">
            <div>
              <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="row">
                  <div><label htmlFor="tc">Colour</label><input id="tc" type="color" value={tpl.accent} onChange={(e) => setT({ accent: e.target.value })} style={{ padding: 2 }} /></div>
                  <div><label htmlFor="tf">Font</label><select id="tf" value={tpl.font} onChange={(e) => setT({ font: e.target.value })}><option value="sans">Sans-serif</option><option value="serif">Serif</option></select></div>
                </div>
                <div className="row">
                  <div><label htmlFor="tl">Layout</label><select id="tl" value={tpl.layout} onChange={(e) => setT({ layout: e.target.value })}><option value="classic">Classic</option><option value="compact">Compact</option></select></div>
                  <div><label htmlFor="tp">Paper</label><select id="tp" value={tpl.paper} onChange={(e) => setT({ paper: e.target.value })}><option value="A4">A4</option><option value="A5">A5</option></select></div>
                </div>
                <label htmlFor="lg">Logo (PNG or JPEG, under 150 KB)</label>
                <input id="lg" type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} />
                {tpl.logoDataUrl && <button type="button" className="link" onClick={() => setT({ logoDataUrl: null })}>Remove logo</button>}
                {([['showBank', 'Payment details'], ['showAmountInWords', 'Total in words'], ['showUpiQr', 'UPI QR code'], ['showNotes', 'Notes'], ['showTerms', 'Terms'], ['showSignature', 'Signature line']] as const).map(([k, l]) => (
                  <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={tpl[k]} onChange={(e) => setT({ [k]: e.target.checked } as Partial<Tpl>)} /> Show {l.toLowerCase()}</label>))}
                <label htmlFor="ft">Footer line</label><input id="ft" maxLength={200} value={tpl.footerText} onChange={(e) => setT({ footerText: e.target.value })} />
                <button type="button" onClick={async () => { setErr(''); setMsg(''); try { await api('/api/template', { method: 'PUT', body: tpl }); setMsg('Template saved.'); } catch (x) { setErr((x as Error).message); } }}>Save template</button>
              </fieldset>
              <h3 style={{ marginTop: 24 }}>Always printed, cannot be changed</h3>
              <ul className="locked">{locked.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <iframe className="preview" style={{ height: 640 }} title="Template preview" sandbox="" srcDoc={preview} />
          </div>
        </div>
      )}
    </>
  );
}
