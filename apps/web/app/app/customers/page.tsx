'use client';
import { useCallback, useEffect, useState } from 'react';
import PartyCustomFields from '../../../components/PartyCustomFields';
import { CURRENCIES, gstinValid, STATE_NAMES } from '@kora/tax';
import { api } from '../../../lib/client';
import { csvText, downloadCsv } from '../../../lib/listTools';

type Party = { id: string; name: string; gstin: string | null; state_code: string; phone: string | null; email: string | null; currency?: string; billing_address?: Record<string, string> };
const EMPTY = { name: '', gstin: '', stateCode: '', phone: '', email: '', currency: 'INR', line1: '', city: '', pincode: '' };

export default function Customers() {
  const [rows, setRows] = useState<Party[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [portal, setPortal] = useState<{ party: Party; active: boolean; views: number; lastViewed: string | null; url: string | null; copied: boolean } | null>(null);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); }, []);
  const [fieldsFor, setFieldsFor] = useState<Party | null>(null);
  const canPortal = role === 'owner' || role === 'staff';

  const openPortal = async (party: Party) => {
    setErr('');
    try {
      const s = await api(`/api/parties/${party.id}/portal`);
      setPortal({ party, active: !!s.active, views: s.view_count ?? 0, lastViewed: s.last_viewed_at ?? null, url: null, copied: false });
    } catch (x) { setErr((x as Error).message); }
  };
  const makeLink = async () => {
    if (!portal) return;
    try { const r = await api(`/api/parties/${portal.party.id}/portal`, { body: {} }); setPortal({ ...portal, active: true, views: 0, lastViewed: null, url: r.url, copied: false }); }
    catch (x) { setErr((x as Error).message); }
  };
  const stopLink = async () => {
    if (!portal) return;
    try { await api(`/api/parties/${portal.party.id}/portal`, { method: 'DELETE' }); setPortal({ ...portal, active: false, url: null }); }
    catch (x) { setErr((x as Error).message); }
  };

  const load = useCallback(() => api(`/api/parties${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setRows(r.parties)), [q]);
  useEffect(() => { void load(); }, [load]);

  const g = form.gstin.trim().toUpperCase();
  const stateFromGstin = g.length >= 2 && STATE_NAMES[g.slice(0, 2)] ? g.slice(0, 2) : '';
  const state = stateFromGstin || form.stateCode;

  return (
    <>
      <h1>Customers</h1>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault(); setErr('');
        try {
          const body = { kind: 'customer', name: form.name, gstin: g || null, stateCode: state || null, phone: form.phone || null, email: form.email || null, currency: form.currency,
            billingAddress: { line1: form.line1, city: form.city, pincode: form.pincode } };
          await api(editing ? `/api/parties/${editing}` : '/api/parties', { method: editing ? 'PUT' : 'POST', body });
          setForm(EMPTY); setEditing(null); await load();
        } catch (x) { setErr((x as Error).message); }
      }}>
        <h2>{editing ? 'Edit customer' : 'Add a customer'}</h2>
        <div className="row">
          <div><label htmlFor="cn">Name</label><input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label htmlFor="cg">GSTIN</label><input id="cg" maxLength={15} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            {g.length === 15 && !gstinValid(g) && <div className="error">Not a valid GSTIN.</div>}</div>
          <div><label htmlFor="cs">State</label>
            <select id="cs" value={state} disabled={!!stateFromGstin} onChange={(e) => setForm({ ...form, stateCode: e.target.value })}>
              <option value="">Choose a state</option>
              {Object.entries(STATE_NAMES).filter(([c]) => !['97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{c === '96' ? 'Outside India (quotes only)' : n}</option>)}
            </select></div>
        </div>
        <div className="row">
          <div><label htmlFor="cp">Mobile</label><input id="cp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label htmlFor="ce">Email</label><input id="ce" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label htmlFor="cur">Usual quote currency</label>
            <select id="cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c} value={c}>{c === 'INR' ? 'INR (rupees)' : c}</option>)}</select></div>
        </div>
        <p className="muted">Address is needed for e-invoices to businesses.</p>
        <div className="row">
          <div><label htmlFor="cl">Address line 1</label><input id="cl" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></div>
          <div><label htmlFor="cc">City</label><input id="cc" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label htmlFor="cpn">Pincode</label><input id="cpn" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
        </div>
        <button>{editing ? 'Save changes' : 'Add customer'}</button>
        {editing && <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      <label htmlFor="sq">Search</label><input id="sq" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
      {fieldsFor && <PartyCustomFields partyId={fieldsFor.id} name={fieldsFor.name} canWrite={role === 'owner' || role === 'staff'} onClose={() => setFieldsFor(null)} />}
      {portal && (
        <div className="panel" role="region" aria-label={`Portal for ${portal.party.name}`} data-testid="portal-panel">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Client portal: {portal.party.name}</h2>
            <button className="secondary" onClick={() => setPortal(null)}>Close</button>
          </div>
          <p className="muted">A private page where this customer sees what they owe, pays, answers estimates and reads their statement. They need no account. Anyone with the link can open it.</p>
          {portal.active && !portal.url && <p>The link is live. Opened {portal.views} time{portal.views === 1 ? '' : 's'}{portal.lastViewed ? `, last on ${portal.lastViewed.slice(0, 10)}` : ''}. For safety it can only be shown when it is made, so make a new one to share it again.</p>}
          {portal.url && (
            <>
              <label htmlFor="portal-url">Link to send</label>
              <input id="portal-url" readOnly value={portal.url} onFocus={(e) => e.currentTarget.select()} />
              <div className="row" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
                <button className="secondary" style={{ flex: 'none', marginTop: 0 }} onClick={async () => { await navigator.clipboard.writeText(portal.url!); setPortal({ ...portal, copied: true }); }}>{portal.copied ? 'Copied' : 'Copy link'}</button>
                {(() => {
                  const digits = (portal.party.phone ?? '').replace(/\D/g, '').slice(-10);
                  const text = `Hello ${portal.party.name}, you can see your account, pay and read your statement here: ${portal.url}`;
                  return (<>
                    {digits.length === 10 && <a className="btn secondary" style={{ flex: 'none', marginTop: 0 }} href={`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
                    {portal.party.email && <a className="btn secondary" style={{ flex: 'none', marginTop: 0 }} href={`mailto:${portal.party.email}?subject=${encodeURIComponent('Your account')}&body=${encodeURIComponent(text)}`}>Email it</a>}
                  </>);
                })()}
              </div>
            </>)}
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
            <button style={{ flex: 'none', marginTop: 0 }} onClick={() => void makeLink()}>{portal.active ? 'Make a new link' : 'Make a link'}</button>
            {portal.active && <button className="danger" style={{ flex: 'none', marginTop: 0 }} onClick={() => void stopLink()}>Stop this link</button>}
            <a className="btn secondary" style={{ flex: 'none', marginTop: 0 }} href={`/app/reports?tab=statement&party=${portal.party.id}`}>View statement</a>
          </div>
          {portal.active && <p className="muted">Making a new link stops the old one.</p>}
        </div>)}
      {rows.length > 0 && <div className="listtools"><button type="button" className="secondary sm" onClick={() => downloadCsv('customers.csv', csvText(['Name', 'GSTIN', 'State code', 'Mobile', 'Email', 'City'],
        rows.map((p) => [p.name, p.gstin ?? '', p.state_code, p.phone ?? '', p.email ?? '', p.billing_address?.city ?? ''])))}>Export CSV</button></div>}
      <table className="t">
        <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Mobile</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td><a href={`/app/customers/${p.id}`}>{p.name}</a>{p.currency && p.currency !== 'INR' ? <span className="muted"> ({p.currency})</span> : null}</td><td>{p.gstin ?? ''}</td><td>{p.state_code === '96' ? 'Outside India' : STATE_NAMES[p.state_code]}</td><td>{p.phone ?? ''}</td>
            <td className="n"><button className="link" onClick={() => { setEditing(p.id); setForm({ name: p.name, gstin: p.gstin ?? '', stateCode: p.state_code, phone: p.phone ?? '', email: p.email ?? '', currency: p.currency ?? 'INR', line1: p.billing_address?.line1 ?? '', city: p.billing_address?.city ?? '', pincode: p.billing_address?.pincode ?? '' }); window.scrollTo(0, 0); }}>Edit</button>{' '}
              {canPortal && <button className="link" onClick={() => void openPortal(p)}>Portal</button>}{' '}
              <button className="link" onClick={() => setFieldsFor(p)}>Fields</button>{' '}
              <button className="link" onClick={async () => { await api(`/api/parties/${p.id}`, { method: 'DELETE' }); await load(); }}>Archive</button></td></tr>))}</tbody>
      </table>
    </>
  );
}
