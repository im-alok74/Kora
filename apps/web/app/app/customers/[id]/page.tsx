'use client';
import { use, useEffect, useState } from 'react';
import { STATE_NAMES } from '@kora/tax';
import Icon from '../../../../components/Icon';
import { api, DOC_LABEL, rupees } from '../../../../lib/client';
import RemindersPanel from './reminders-panel';

type Overview = {
  party: { id: string; kind: string; name: string; gstin: string | null; phone: string | null; email: string | null; stateCode: string; address: Record<string, string>; since: string; archived: boolean };
  summary: { billedPaise: string; invoices: number; lastBilled: string | null; outstandingPaise: string; overduePaise: string; openInvoices: number; maxDaysLate: number; receivedPaise: string; averageDaysToPay: number | null };
  documents: { id: string; number: string | null; doc_type: string; status: string; doc_date: string; total_paise: string; payment_status: string; currency: string }[];
  payments: { id: string; received_on: string; amount_paise: string; method: string; note: string | null }[];
};
const ADV_METHODS: [string, string][] = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['netbanking', 'Net banking'], ['other', 'Other']];
const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['payments', 'Payments'], ['people', 'People and places'], ['reminders', 'Reminders'], ['details', 'Details']] as const;

type Contact = { id: string; name: string; designation: string | null; email: string | null; phone: string | null; is_primary: boolean };
type PartyAddress = { id: string; label: string; address: Record<string, string>; state_code: string; is_default_billing: boolean; is_default_shipping: boolean };
const EMPTY_CONTACT = { name: '', designation: '', email: '', phone: '' };
const EMPTY_ADDRESS = { label: '', line1: '', line2: '', city: '', pincode: '', stateCode: '' };
const stateName = (c: string) => (c === '96' ? 'Outside India' : STATE_NAMES[c] ?? c);
const oneLine = (a: Record<string, string>) => [a?.line1, a?.line2, a?.city, a?.pincode].filter(Boolean).join(', ');

/** One customer: what they owe, how they pay, their documents and payments, all in one place. */
export default function Customer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Overview | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [credit, setCredit] = useState<{ totalPaise: string; payments: { id: string; available_paise: string; method: string; received_on: string; note: string | null }[] } | null>(null);
  const [adv, setAdv] = useState({ amount: '', method: 'bank_transfer', note: '' });
  const [ref, setRef] = useState<{ id: string; amount: string; method: string; note: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [addresses, setAddresses] = useState<PartyAddress[]>([]);
  const [cForm, setCForm] = useState({ ...EMPTY_CONTACT, id: '' });
  const [aForm, setAForm] = useState({ ...EMPTY_ADDRESS, id: '' });
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [listId, setListId] = useState('');
  useEffect(() => {
    api('/api/price-lists').then((r) => setLists(r.priceLists)).catch(() => {});
    api(`/api/parties/${id}`).then((r) => setListId(r.party.price_list_id ?? '')).catch(() => {});
  }, [id]);
  const loadCredit = () => api(`/api/parties/${id}/credit`).then(setCredit).catch(() => {});
  const loadBook = async () => {
    setContacts((await api(`/api/parties/${id}/contacts`)).contacts);
    setAddresses((await api(`/api/parties/${id}/addresses`)).addresses);
  };
  useEffect(() => { void loadCredit(); void loadBook().catch(() => {}); }, [id]);
  const book = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); try { await fn(); await loadBook(); } catch (e) { setErr((e as Error).message); } };
  const act = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); try { await fn(); await loadCredit(); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { api(`/api/parties/${id}/overview`).then(setD).catch((e) => setErr(e.message)); api('/api/business').then((b) => setRole(b.role)); }, [id]);

  if (!d) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  const { party: p, summary: s } = d;
  const owing = BigInt(s.outstandingPaise) > 0n;
  const late = BigInt(s.overduePaise) > 0n;
  const canWrite = role === 'owner' || role === 'staff';
  const addr = [p.address?.line1, p.address?.line2, p.address?.city, p.address?.pincode].filter(Boolean).join(', ');

  return (
    <>
      <div className="doc-head">
        <div>
          <h1>{p.name}</h1>
          <div className="meta">
            {late ? <span className="chip cancelled">Overdue</span> : owing ? <span className="chip issued">Owes money</span> : <span className="chip paid">All paid</span>}
            <span>{p.gstin ?? 'No GSTIN'}{p.phone ? ` · ${p.phone}` : ''}{p.email ? ` · ${p.email}` : ''}</span>
          </div>
        </div>
        <div className="doc-amount"><div className="big" data-testid="owed">{rupees(s.outstandingPaise)}</div><div className={late ? 'due' : 'muted'}>{late ? `${rupees(s.overduePaise)} overdue, up to ${s.maxDaysLate} days late` : 'owed to you'}</div></div>
        <div className="row doc-actions">
          <a className="btn secondary" href="/app/customers">Back</a>
          {canWrite && <a className="btn" href="/app/invoices/new"><Icon name="plus" size={18} />New invoice</a>}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Customer">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'overview' && (<>
        <div className="stats">
          <div className="stat"><div className="label">Billed so far</div><div className="value">{rupees(s.billedPaise)}</div></div>
          <div className="stat"><div className="label">Received</div><div className="value">{rupees(s.receivedPaise)}</div></div>
          <div className="stat"><div className="label">Invoices</div><div className="value">{s.invoices}</div></div>
          <div className="stat"><div className="label">Usually pays in</div><div className="value">{s.averageDaysToPay === null ? 'No data' : `${s.averageDaysToPay} days`}</div></div>
        </div>
        <div className="panel"><p className="section-label">Recent documents</p>
          {d.documents.length === 0 ? <p className="muted">Nothing billed to this customer yet.</p> : (
            <ul className="plain">{d.documents.slice(0, 6).map((x) => (<li key={x.id}><span><a href={`/app/invoices/${x.id}`}>{x.number ?? 'Draft'}</a> · {DOC_LABEL[x.doc_type] ?? x.doc_type} · {x.doc_date}</span><span>{rupees(x.total_paise)}</span></li>))}</ul>)}
        </div>
      </>)}

      {tab === 'documents' && (
        <div className="panel">
          {d.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
            <table className="t" aria-label="Documents"><thead><tr><th>Number</th><th>Type</th><th>Date</th><th className="n">Total</th><th>Status</th></tr></thead>
              <tbody>{d.documents.map((x) => (<tr key={x.id}><td><a href={`/app/invoices/${x.id}`}>{x.number ?? 'Draft'}</a></td><td>{DOC_LABEL[x.doc_type] ?? x.doc_type}</td><td>{x.doc_date}</td><td className="n">{rupees(x.total_paise)}</td>
                <td>{x.status === 'draft' ? 'Draft' : x.status === 'cancelled' ? 'Cancelled' : x.payment_status === 'paid' ? 'Paid' : x.payment_status === 'part_paid' ? 'Part paid' : 'Issued'}</td></tr>))}</tbody></table>)}
        </div>)}

      {tab === 'payments' && (
        <p className="row" style={{ justifyContent: 'flex-start' }}>
          <a className="btn secondary sm" href={`/app/reports?tab=statement&party=${id}`}>Statement of account</a>
          <a className="btn secondary sm" href={`/api/reports/statement?party=${id}&from=2017-07-01&format=csv`}>Download statement (CSV)</a>
        </p>)}
      {tab === 'payments' && credit && (
        <div className="panel" aria-label="Advances and credit">
          <h2>Advances and credit</h2>
          <p><b data-testid="credit-held">{rupees(credit.totalPaise)}</b> held for this customer. It is applied to the next invoice you choose, or returned.</p>
          {msg && <p className="ok" role="status">{msg}</p>}
          {err && <p className="error" role="alert">{err}</p>}
          {credit.payments.length > 0 && (
            <table className="t" aria-label="Money held"><thead><tr><th>Received</th><th>Method</th><th>Note</th><th className="n">Held</th><th /></tr></thead>
              <tbody>{credit.payments.map((x) => (
                <tr key={x.id}><td>{x.received_on}</td><td>{x.method.replace(/_/g, ' ')}</td><td>{x.note ?? ''}</td><td className="n">{rupees(x.available_paise)}</td>
                  <td className="n">{canWrite && <button className="link" onClick={() => setRef({ id: x.id, amount: (Number(x.available_paise) / 100).toFixed(2), method: 'bank_transfer', note: '' })}>Refund</button>}</td></tr>))}</tbody></table>)}
          {ref && canWrite && (
            <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await api(`/api/payments/${ref.id}/refund`, { body: { amount: ref.amount, method: ref.method, note: ref.note || undefined } }); setRef(null); setMsg('Refund recorded.'); }); }}>
              <div className="row">
                <div><label htmlFor="ra">Amount to return (Rs)</label><input id="ra" inputMode="decimal" value={ref.amount} onChange={(e) => setRef({ ...ref, amount: e.target.value })} required /></div>
                <div><label htmlFor="rm">How</label><select id="rm" value={ref.method} onChange={(e) => setRef({ ...ref, method: e.target.value })}>{ADV_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label htmlFor="rn">Note</label><input id="rn" value={ref.note} onChange={(e) => setRef({ ...ref, note: e.target.value })} /></div>
                <button>Record refund</button><button type="button" className="secondary" onClick={() => setRef(null)}>Cancel</button>
              </div>
            </form>)}
          {canWrite && (
            <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await api(`/api/parties/${id}/credit`, { body: { amount: adv.amount, method: adv.method, note: adv.note || undefined } }); setAdv({ amount: '', method: adv.method, note: '' }); setMsg('Advance recorded.'); }); }}>
              <h3 style={{ marginTop: 16 }}>Record an advance</h3>
              <div className="row">
                <div><label htmlFor="aa">Amount received (Rs)</label><input id="aa" inputMode="decimal" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} required /></div>
                <div><label htmlFor="am">Method</label><select id="am" value={adv.method} onChange={(e) => setAdv({ ...adv, method: e.target.value })}>{ADV_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label htmlFor="an2">Note</label><input id="an2" value={adv.note} onChange={(e) => setAdv({ ...adv, note: e.target.value })} placeholder="Optional" /></div>
                <button>Record advance</button>
              </div>
              <p className="muted">For an advance towards services, GST can be due when the money is received. Check with your CA whether a receipt voucher applies.</p>
            </form>)}
        </div>)}

      {tab === 'payments' && (
        <div className="panel">
          {d.payments.length === 0 ? <p className="muted">No payments received yet.</p> : (
            <table className="t" aria-label="Payments"><thead><tr><th>Date</th><th>Method</th><th>Note</th><th className="n">Amount</th><th /></tr></thead>
              <tbody>{d.payments.map((x) => (<tr key={x.id}><td>{x.received_on}</td><td>{x.method.replace(/_/g, ' ')}</td><td>{x.note ?? ''}</td><td className="n">{rupees(x.amount_paise)}</td><td className="n"><a href={`/api/payments/${x.id}/receipt`} target="_blank" rel="noreferrer">Receipt</a></td></tr>))}</tbody></table>)}
        </div>)}

      {tab === 'people' && (<>
        {msg && <p className="ok" role="status">{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="panel" aria-label="Contact persons">
          <h2>Contact persons</h2>
          {contacts.length === 0 ? <p className="muted">No one named yet. The customer&apos;s own phone and email are still used on documents.</p> : (
            <table className="t" aria-label="Contacts"><thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th><th /></tr></thead>
              <tbody>{contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}{c.is_primary && <span className="chip paid" style={{ marginLeft: 8 }}>Primary</span>}</td>
                  <td>{c.designation ?? ''}</td><td>{c.phone ?? ''}</td><td>{c.email ?? ''}</td>
                  <td className="n">{canWrite && (<>
                    {!c.is_primary && <button className="link" onClick={() => void book(async () => { await api(`/api/parties/${id}/contacts/${c.id}`, { body: {} }); setMsg('Primary contact changed.'); })}>Make primary</button>}
                    {' '}<button className="link" onClick={() => setCForm({ id: c.id, name: c.name, designation: c.designation ?? '', email: c.email ?? '', phone: c.phone ?? '' })}>Edit</button>
                    {' '}<button className="link" onClick={() => void book(async () => { await api(`/api/parties/${id}/contacts/${c.id}`, { method: 'DELETE' }); setMsg('Contact removed.'); })}>Remove</button>
                  </>)}</td>
                </tr>))}</tbody></table>)}
          {canWrite && (
            <form onSubmit={(e) => { e.preventDefault(); void book(async () => {
              const body = { name: cForm.name, designation: cForm.designation || null, email: cForm.email || null, phone: cForm.phone || null };
              await api(cForm.id ? `/api/parties/${id}/contacts/${cForm.id}` : `/api/parties/${id}/contacts`, { method: cForm.id ? 'PUT' : 'POST', body: cForm.id ? { ...body, isPrimary: contacts.find((x) => x.id === cForm.id)?.is_primary ?? false } : body });
              setCForm({ ...EMPTY_CONTACT, id: '' }); setMsg(cForm.id ? 'Contact saved.' : 'Contact added.');
            }); }}>
              <h3 style={{ marginTop: 16 }}>{cForm.id ? 'Edit contact person' : 'Add a contact person'}</h3>
              <div className="row">
                <div><label htmlFor="cn">Name</label><input id="cn" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} required /></div>
                <div><label htmlFor="cd">Designation</label><input id="cd" value={cForm.designation} onChange={(e) => setCForm({ ...cForm, designation: e.target.value })} placeholder="Accounts" /></div>
                <div><label htmlFor="cph">Phone</label><input id="cph" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} /></div>
                <div><label htmlFor="cem">Email</label><input id="cem" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} /></div>
                <button>{cForm.id ? 'Save contact' : 'Add contact'}</button>
                {cForm.id && <button type="button" className="secondary" onClick={() => setCForm({ ...EMPTY_CONTACT, id: '' })}>Cancel</button>}
              </div>
            </form>)}
        </div>

        <div className="panel" aria-label="Addresses">
          <h2>Addresses</h2>
          {addresses.length === 0 ? <p className="muted">No extra addresses yet. Documents use the address on the customer record.</p> : (
            <table className="t" aria-label="Address book"><thead><tr><th>Label</th><th>Address</th><th>State</th><th /></tr></thead>
              <tbody>{addresses.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}
                    {a.is_default_billing && <span className="chip issued" style={{ marginLeft: 8 }}>Billing</span>}
                    {a.is_default_shipping && <span className="chip paid" style={{ marginLeft: 8 }}>Shipping</span>}</td>
                  <td>{oneLine(a.address) || <span className="muted">Not given</span>}</td>
                  <td>{stateName(a.state_code)}</td>
                  <td className="n">{canWrite && (<>
                    {!a.is_default_billing && <button className="link" onClick={() => void book(async () => { await api(`/api/parties/${id}/addresses/${a.id}`, { body: { kind: 'billing' } }); setMsg('Default billing address changed.'); })}>Bill here</button>}
                    {' '}{!a.is_default_shipping && <button className="link" onClick={() => void book(async () => { await api(`/api/parties/${id}/addresses/${a.id}`, { body: { kind: 'shipping' } }); setMsg('Default shipping address changed.'); })}>Ship here</button>}
                    {' '}<button className="link" onClick={() => setAForm({ id: a.id, label: a.label, line1: a.address?.line1 ?? '', line2: a.address?.line2 ?? '', city: a.address?.city ?? '', pincode: a.address?.pincode ?? '', stateCode: a.state_code })}>Edit</button>
                    {' '}<button className="link" onClick={() => void book(async () => { await api(`/api/parties/${id}/addresses/${a.id}`, { method: 'DELETE' }); setMsg('Address removed.'); })}>Remove</button>
                  </>)}</td>
                </tr>))}</tbody></table>)}
          {canWrite && (
            <form onSubmit={(e) => { e.preventDefault(); void book(async () => {
              const body = { label: aForm.label, stateCode: aForm.stateCode, address: { line1: aForm.line1, line2: aForm.line2, city: aForm.city, pincode: aForm.pincode } };
              const was = addresses.find((x) => x.id === aForm.id);
              await api(aForm.id ? `/api/parties/${id}/addresses/${aForm.id}` : `/api/parties/${id}/addresses`, {
                method: aForm.id ? 'PUT' : 'POST',
                body: aForm.id ? { ...body, isDefaultBilling: was?.is_default_billing ?? false, isDefaultShipping: was?.is_default_shipping ?? false } : body,
              });
              setAForm({ ...EMPTY_ADDRESS, id: '' }); setMsg(aForm.id ? 'Address saved.' : 'Address added.');
            }); }}>
              <h3 style={{ marginTop: 16 }}>{aForm.id ? 'Edit address' : 'Add an address'}</h3>
              <div className="row">
                <div><label htmlFor="al">Label</label><input id="al" value={aForm.label} onChange={(e) => setAForm({ ...aForm, label: e.target.value })} placeholder="Head office" required /></div>
                <div><label htmlFor="a1">Address line 1</label><input id="a1" value={aForm.line1} onChange={(e) => setAForm({ ...aForm, line1: e.target.value })} /></div>
                <div><label htmlFor="a2">Address line 2</label><input id="a2" value={aForm.line2} onChange={(e) => setAForm({ ...aForm, line2: e.target.value })} /></div>
              </div>
              <div className="row">
                <div><label htmlFor="ac">City</label><input id="ac" value={aForm.city} onChange={(e) => setAForm({ ...aForm, city: e.target.value })} /></div>
                <div><label htmlFor="ap">PIN code</label><input id="ap" value={aForm.pincode} onChange={(e) => setAForm({ ...aForm, pincode: e.target.value })} /></div>
                <div><label htmlFor="as">State</label>
                  <select id="as" value={aForm.stateCode} onChange={(e) => setAForm({ ...aForm, stateCode: e.target.value })} required>
                    <option value="">Choose a state</option>
                    {Object.entries(STATE_NAMES).filter(([c]) => !['97', '99'].includes(c)).map(([c, n]) => <option key={c} value={c}>{c === '96' ? 'Outside India' : n}</option>)}
                  </select></div>
                <button>{aForm.id ? 'Save address' : 'Add address'}</button>
                {aForm.id && <button type="button" className="secondary" onClick={() => setAForm({ ...EMPTY_ADDRESS, id: '' })}>Cancel</button>}
              </div>
              <p className="muted">Where the goods go decides the place of supply, so each address carries its own state.</p>
            </form>)}
        </div>
      </>)}

      {tab === 'reminders' && <RemindersPanel partyId={id} canWrite={canWrite} />}
      {tab === 'details' && (
        <div className="panel">
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 20px', margin: 0 }}>
            <dt className="muted">Type</dt><dd style={{ margin: 0 }}>{p.kind === 'both' ? 'Customer and vendor' : p.kind === 'vendor' ? 'Vendor' : 'Customer'}</dd>
            <dt className="muted">GSTIN</dt><dd style={{ margin: 0 }}>{p.gstin ?? 'Not given'}</dd>
            <dt className="muted">State code</dt><dd style={{ margin: 0 }}>{p.stateCode === '96' ? 'Outside India' : p.stateCode}</dd>
            <dt className="muted">Mobile</dt><dd style={{ margin: 0 }}>{p.phone ?? 'Not given'}</dd>
            <dt className="muted">Email</dt><dd style={{ margin: 0 }}>{p.email ?? 'Not given'}</dd>
            <dt className="muted">Address</dt><dd style={{ margin: 0 }}>{addr || 'Not given'}</dd>
            <dt className="muted">Customer since</dt><dd style={{ margin: 0 }}>{new Date(p.since).toLocaleDateString('en-IN')}</dd>
          </dl>
          <div style={{ marginTop: 14, maxWidth: 360 }}>
            <label htmlFor="pl">Price list</label>
            <select id="pl" value={lists.some((l) => l.id === listId) ? listId : ''} disabled={!canWrite}
              onChange={(e) => { const v = e.target.value; setErr(''); setMsg(''); api(`/api/parties/${id}/price-list`, { method: 'PUT', body: { priceListId: v || null } }).then(() => { setListId(v); setMsg('Price list saved.'); }).catch((x) => setErr(x.message)); }}>
              <option value="">None: use item prices</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <p className="muted">New invoice lines for this customer take their price from this list. Invoices already made are not changed.</p>
            {msg && <p className="ok" role="status">{msg}</p>}
            {err && <p className="error" role="alert">{err}</p>}
          </div>
          {canWrite && <p style={{ marginTop: 14 }}><a href="/app/customers">Edit this customer in the list</a></p>}
        </div>)}
    </>
  );
}
