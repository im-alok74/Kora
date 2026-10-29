'use client';
import KoraLoader from '../../components/KoraLoader';
import { useEffect, useState } from 'react';
import { formatMoney } from '@kora/tax';
import Icon from '../../components/Icon';
import { api, DOC_LABEL, rupees } from '../../lib/client';

type Dash = {
  business: { name: string }; today: string;
  owed: { outstanding: string; overdue: string; unpaid: number; overdueCount: number };
  thisMonth: { sales: string; collected: string; expenses: string };
  dueThisWeek: { amount: string; count: number };
  topCustomers: { name: string; partyId: string | null; total: string }[];
  unallocated?: { count: number; amount: string };
  toPay: { owed: string; late: string; dueThisWeek: string; bills: number; msmeAttention: number };
  chart: { key: string; label: string; total: string }[];
  attention: { overdue: { id: string; number: string; party_name: string; outstanding_paise: string; days: number }[]; drafts: number; openEstimates: number; acceptedEstimates: number };
  recent: { id: string; number: string | null; doc_type: string; status: string; doc_date: string; currency: string; total_paise: string; payment_status: string; party_name: string; estimate_status: string | null }[];
  setup: { customers: number; items: number; documents: number; hasAddress: boolean; hasUpi: boolean; hasPhone: boolean };
};

/** Indian short form: 12,345 -> 12.3k, 1,23,456 -> 1.2 L, 1,23,45,678 -> 1.2 Cr. */
const compact = (p: string) => {
  const n = Number(BigInt(p) / 100n);
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
};
const EST: Record<string, [string, string]> = { open: ['Open', 'issued'], accepted: ['Accepted', 'paid'], declined: ['Declined', 'cancelled'], expired: ['Expired', 'cancelled'], invoiced: ['Invoiced', 'paid'], draft: ['Draft', 'draft'], cancelled: ['Cancelled', 'cancelled'] };
function statusOf(r: Dash['recent'][number]): [string, string] {
  if (r.estimate_status) return EST[r.estimate_status] ?? [r.estimate_status, 'issued'];
  if (r.status === 'draft') return ['Draft', 'draft'];
  if (r.status === 'cancelled') return ['Cancelled', 'cancelled'];
  return r.payment_status === 'paid' ? ['Paid', 'paid'] : r.payment_status === 'part_paid' ? ['Part paid', 'due'] : ['Issued', 'issued'];
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/dashboard').then(setD).catch((e) => setErr(e.message));
    api('/api/business').then((b) => setRole(b.role));
  }, []);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!d) return <KoraLoader />;

  const canWrite = role === 'owner' || role === 'staff';
  const max = d.chart.reduce((m, c) => (BigInt(c.total) > m ? BigInt(c.total) : m), 1n);
  const steps = [
    { done: d.setup.hasAddress && d.setup.hasUpi, label: 'Add your address and UPI ID', hint: 'They appear on every invoice, with a QR to pay.', href: '/app/settings' },
    { done: d.setup.customers > 0, label: 'Add a customer', hint: 'Or import a list from a spreadsheet.', href: '/app/customers' },
    { done: d.setup.items > 0, label: 'Add what you sell', hint: 'Items fill in the HSN code and GST rate for you.', href: '/app/items' },
    { done: d.setup.documents > 0, label: 'Create your first invoice', hint: 'Tax is worked out as you type.', href: '/app/invoices/new' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const owing = BigInt(d.owed.outstanding) > 0n;

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">{greeting()}. Here is {d.business.name} today, {new Date(d.today + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
        </div>
        {canWrite && <a className="btn" href="/app/invoices/new"><Icon name="plus" size={18} />New invoice</a>}
      </div>

      {canWrite && doneCount < steps.length && (
        <section className="panel" aria-label="Get set up" data-testid="setup">
          <div className="panel-head"><h2>Get set up</h2><span className="muted">{doneCount} of {steps.length} done</span></div>
          <ul className="list">
            {steps.map((s) => (
              <li key={s.label}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', background: s.done ? 'var(--accent)' : 'var(--surface)', color: s.done ? '#fff' : 'var(--text-faint)', border: s.done ? 0 : '1px solid var(--border-strong)' }}>{s.done ? <Icon name="check" size={14} /> : null}</span>
                  <span className="who-line"><b style={{ fontWeight: s.done ? 500 : 700, color: s.done ? 'var(--text-muted)' : undefined, textDecoration: s.done ? 'line-through' : undefined }}>{s.label}</b><span className="muted">{s.hint}</span></span>
                </span>
                {!s.done && <a href={s.href} className="btn secondary sm" aria-label={`${s.label}: open`}>Open</a>}
              </li>))}
          </ul>
          <p className="muted" style={{ marginTop: 12 }}>
            <a href="/app/welcome">Open the guided setup</a>
            {d.setup.documents === 0 && <> · <button type="button" className="link" onClick={async () => { try { await api('/api/demo', { body: {} }); window.location.href = '/app'; } catch (e) { setErr((e as Error).message); } }} data-testid="try-demo">Try it with sample data</button> (a labelled demo business you can remove in one click)</>}
          </p>
        </section>)}

      <section className="stats" aria-label="At a glance">
        <div className="stat accent"><div className="label">To collect</div><div className="value" data-testid="stat-owed">{rupees(d.owed.outstanding)}</div><div className="sub">{d.owed.unpaid} unpaid invoice{d.owed.unpaid === 1 ? '' : 's'}</div></div>
        <div className={`stat${BigInt(d.owed.overdue) > 0n ? ' danger' : ''}`}><div className="label">Overdue</div><div className="value" data-testid="stat-overdue">{rupees(d.owed.overdue)}</div><div className="sub">{d.owed.overdueCount} past due</div></div>
        <div className="stat"><div className="label">Sales this month</div><div className="value" data-testid="stat-sales">{rupees(d.thisMonth.sales)}</div><div className="sub">Billed, after credit notes</div></div>
        <div className="stat good"><div className="label">Collected this month</div><div className="value" data-testid="stat-collected">{rupees(d.thisMonth.collected)}</div><div className="sub">Money received</div></div>
        <div className="stat"><div className="label">Spent this month</div><div className="value" data-testid="stat-spent">{rupees(d.thisMonth.expenses)}</div><div className="sub"><a href="/app/expenses">See expenses</a></div></div>
      </section>

      {d.unallocated && d.unallocated.count > 0 && <p className="warn" role="status" data-testid="unallocated-note">{d.unallocated.count} online {d.unallocated.count === 1 ? 'payment' : 'payments'} worth {rupees(d.unallocated.amount)} {d.unallocated.count === 1 ? 'is' : 'are'} not applied to any invoice. <a href="/app/reports">Match or refund {d.unallocated.count === 1 ? 'it' : 'them'}</a>.</p>}

      <section className="stats" aria-label="Coming up">
        <div className="stat"><div className="label">Due in the next 7 days</div><div className="value" data-testid="stat-week">{rupees(d.dueThisWeek.amount)}</div><div className="sub">{d.dueThisWeek.count} invoice{d.dueThisWeek.count === 1 ? '' : 's'} falling due</div></div>
        <div className={`stat${BigInt(d.toPay.late) > 0n ? ' danger' : ''}`}><div className="label">You owe vendors</div><div className="value" data-testid="stat-topay">{rupees(d.toPay.owed)}</div><div className="sub">{BigInt(d.toPay.late) > 0n ? `${rupees(d.toPay.late)} is late. ` : ''}{rupees(d.toPay.dueThisWeek)} due this week</div></div>
        {d.toPay.msmeAttention > 0 && <div className="stat danger"><div className="label">Small suppliers to pay</div><div className="value" data-testid="stat-msme">{d.toPay.msmeAttention}</div><div className="sub"><a href="/app/vendors">Within 45 days of the bill</a></div></div>}
      </section>

      {canWrite && (
        <section className="panel" aria-label="Quick actions">
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <a className="btn" style={{ flex: 'none' }} href="/app/invoices/new">New invoice</a>
            <a className="btn secondary" style={{ flex: 'none' }} href="/app/invoices?status=issued">Record a payment</a>
            <a className="btn secondary" style={{ flex: 'none' }} href="/app/expenses">Add an expense</a>
            <a className="btn secondary" style={{ flex: 'none' }} href="/app/purchases">Record a bill</a>
            {d.owed.overdueCount > 0 && <a className="btn secondary" style={{ flex: 'none' }} href="/app/invoices?status=overdue">Chase {d.owed.overdueCount} overdue</a>}
          </div>
        </section>)}

      <div className="dash-grid">
        <div>
          <section className="panel" aria-label="Sales by month">
            <div className="panel-head"><h2>Sales, last six months</h2><a href="/app/reports">Reports</a></div>
            <div className="chart" role="img" aria-label={`Sales by month: ${d.chart.map((c) => `${c.label} ${formatMoney(BigInt(c.total))}`).join(', ')}`}>
              {d.chart.map((c, i) => (
                <div key={c.key} className={`bar${i === d.chart.length - 1 ? ' now' : ''}`}>
                  <b>{BigInt(c.total) > 0n ? compact(c.total) : ''}</b>
                  <div style={{ height: `${Math.max(2, Number((BigInt(c.total) * 100n) / max))}%` }} />
                  <span>{c.label}</span>
                </div>))}
            </div>
          </section>

          <section className="panel" aria-label="Top customers">
            <div className="panel-head"><h2>Top customers, last 12 months</h2><a href="/app/reports?tab=customers">Reports</a></div>
            {d.topCustomers.length === 0 ? <p className="muted">Nothing billed yet.</p> : (
              <ol className="list" data-testid="top-customers">{d.topCustomers.map((c) => (
                <li key={c.name}><span>{c.partyId ? <a href={`/app/customers/${c.partyId}`}>{c.name}</a> : c.name}</span><b>{rupees(c.total)}</b></li>))}</ol>)}
          </section>

          <section className="panel" aria-label="Recent documents">
            <div className="panel-head"><h2>Recent documents</h2><a href="/app/invoices">View all</a></div>
            {d.recent.length === 0 ? (
              <div className="empty"><h3>No documents yet</h3><p>Your invoices and estimates will show up here.</p>{canWrite && <a className="btn" href="/app/invoices/new">Create your first invoice</a>}</div>
            ) : (
              <table className="t" style={{ boxShadow: 'none', border: 0, borderRadius: 0 }}>
                <thead><tr><th>Document</th><th>Customer</th><th className="n">Amount</th><th>Status</th></tr></thead>
                <tbody>{d.recent.map((r) => {
                  const [label, cls] = statusOf(r);
                  return (
                    <tr key={r.id}>
                      <td><a href={`/app/invoices/${r.id}`}>{r.number ?? 'Draft'}</a><div className="muted">{DOC_LABEL[r.doc_type]} · {r.doc_date}</div></td>
                      <td>{r.party_name}</td>
                      <td className="n">{r.currency !== 'INR' ? formatMoney(BigInt(r.total_paise), r.currency) : rupees(r.total_paise)}</td>
                      <td><span className={`chip ${cls}`}>{label}</span></td>
                    </tr>);
                })}</tbody>
              </table>)}
          </section>
        </div>

        <div>
          <section className="panel" aria-label="Needs attention">
            <div className="panel-head"><h2>Needs attention</h2></div>
            {d.attention.overdue.length === 0 && d.attention.drafts === 0 && d.attention.openEstimates === 0 && d.attention.acceptedEstimates === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{owing ? 'Nothing is late. Everything owed is still within its due date.' : 'You are all caught up.'}</p>
            ) : null}
            {d.attention.acceptedEstimates > 0 && <div className="attention" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><Icon name="check" size={18} />{d.attention.acceptedEstimates} accepted estimate{d.attention.acceptedEstimates === 1 ? '' : 's'} to invoice<a href="/app/invoices?type=estimate">Open</a></div>}
            {d.attention.drafts > 0 && <div className="attention"><Icon name="documents" size={18} />{d.attention.drafts} draft{d.attention.drafts === 1 ? '' : 's'} not issued<a href="/app/invoices">Review</a></div>}
            {d.attention.openEstimates > 0 && <div className="attention" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="clock" size={18} />{d.attention.openEstimates} estimate{d.attention.openEstimates === 1 ? '' : 's'} waiting for an answer<a href="/app/invoices?type=estimate">Open</a></div>}
            {d.attention.overdue.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 12 }}>Late payments</div>
                <ul className="list">
                  {d.attention.overdue.map((o) => (
                    <li key={o.id}>
                      <span className="who-line"><a href={`/app/invoices/${o.id}`}>{o.party_name}</a><span className="muted">{o.number} · {o.days} day{o.days === 1 ? '' : 's'} late</span></span>
                      <span className="amount" style={{ color: 'var(--danger)' }}>{rupees(o.outstanding_paise)}</span>
                    </li>))}
                </ul>
              </>)}
          </section>

          {canWrite && (
            <section className="panel" aria-label="Quick actions">
              <div className="panel-head"><h2>Quick actions</h2></div>
              <div className="quick">
                <a className="btn secondary" href="/app/invoices/new"><Icon name="invoice" size={18} />New invoice</a>
                <a className="btn secondary" href="/app/invoices/new?type=estimate"><Icon name="documents" size={18} />New estimate</a>
                <a className="btn secondary" href="/app/expenses"><Icon name="receipt" size={18} />Add expense</a>
                <a className="btn secondary" href="/app/customers"><Icon name="user" size={18} />Add customer</a>
              </div>
            </section>)}
        </div>
      </div>
    </>
  );
}
