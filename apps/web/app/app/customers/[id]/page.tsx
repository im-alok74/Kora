'use client';
import { use, useEffect, useState } from 'react';
import Icon from '../../../../components/Icon';
import { api, DOC_LABEL, rupees } from '../../../../lib/client';

type Overview = {
  party: { id: string; kind: string; name: string; gstin: string | null; phone: string | null; email: string | null; stateCode: string; address: Record<string, string>; since: string; archived: boolean };
  summary: { billedPaise: string; invoices: number; lastBilled: string | null; outstandingPaise: string; overduePaise: string; openInvoices: number; maxDaysLate: number; receivedPaise: string; averageDaysToPay: number | null };
  documents: { id: string; number: string | null; doc_type: string; status: string; doc_date: string; total_paise: string; payment_status: string; currency: string }[];
  payments: { id: string; received_on: string; amount_paise: string; method: string; note: string | null }[];
};
const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['payments', 'Payments'], ['details', 'Details']] as const;

/** One customer: what they owe, how they pay, their documents and payments, all in one place. */
export default function Customer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Overview | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
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
        <div className="panel">
          {d.payments.length === 0 ? <p className="muted">No payments received yet.</p> : (
            <table className="t" aria-label="Payments"><thead><tr><th>Date</th><th>Method</th><th>Note</th><th className="n">Amount</th></tr></thead>
              <tbody>{d.payments.map((x) => (<tr key={x.id}><td>{x.received_on}</td><td>{x.method.replace(/_/g, ' ')}</td><td>{x.note ?? ''}</td><td className="n">{rupees(x.amount_paise)}</td></tr>))}</tbody></table>)}
        </div>)}

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
          {canWrite && <p style={{ marginTop: 14 }}><a href="/app/customers">Edit this customer in the list</a></p>}
        </div>)}
    </>
  );
}
