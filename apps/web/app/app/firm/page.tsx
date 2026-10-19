'use client';
import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees } from '../../../lib/client';

type Client = {
  businessId: string; name: string; gstin: string | null; registrationType: string; role: string; visible: boolean;
  outstanding: string; overdue: string; overdueCount: number; drafts: number; salesThisMonth: string; collectedThisMonth: string;
  deadlines: { form: string; period: string; due: string; daysLeft: number }[]; needsAttention: boolean;
};
type Firm = { totals: { clients: number; outstanding: string; overdue: string; needingAttention: number }; clients: Client[] };

const when = (d: number) => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`);

/** For a CA or anyone who looks after several businesses: who owes what, who is late, and what is due next. */
export default function Firm() {
  const [f, setF] = useState<Firm | null>(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/firm').then(setF).catch((e) => setErr(e.message)); }, []);

  const open = async (id: string, to = '/app') => {
    await api('/api/business/select', { body: { businessId: id } });
    window.location.href = to;
  };

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!f) return <p className="muted">Loading</p>;
  const rows = f.clients.filter((c) => (!only || c.needsAttention) && (c.name + ' ' + (c.gstin ?? '')).toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="toolbar">
        <div><h1>Clients</h1><p className="page-sub">Every business you look after, with what is owed and what is due next.</p></div>
        <a className="btn" href="/setup?add=1"><Icon name="plus" size={18} />Add a client</a>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Clients</div><div className="value" data-testid="firm-clients">{f.totals.clients}</div></div>
        <div className="stat"><div className="label">Owed to your clients</div><div className="value">{rupees(f.totals.outstanding)}</div></div>
        <div className="stat"><div className="label">Overdue</div><div className="value" data-testid="firm-overdue">{rupees(f.totals.overdue)}</div></div>
        <div className="stat"><div className="label">Need attention</div><div className="value" data-testid="firm-attention">{f.totals.needingAttention}</div></div>
      </div>

      <div className="filters">
        <div style={{ flex: 2 }}><label htmlFor="fq">Search</label><input id="fq" type="search" placeholder="Name or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label htmlFor="fo">Show</label>
          <select id="fo" value={only ? 'attn' : 'all'} onChange={(e) => setOnly(e.target.value === 'attn')}>
            <option value="all">All clients</option><option value="attn">Needing attention</option>
          </select></div>
      </div>

      {rows.length === 0 ? (
        <div className="panel empty"><Icon name="team" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No clients match</h3><p>Clear the search, or add a client.</p></div>
      ) : (
        <table className="t cards" aria-label="Clients">
          <thead><tr><th>Client</th><th className="n">Owed</th><th className="n">Overdue</th><th className="n">Drafts</th><th>Next GST dates</th><th /></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.businessId}>
              <td className="c-num"><b>{c.name}</b><br /><span className="muted">{c.gstin ?? 'Not registered'} · your role: {c.role}</span></td>
              {c.visible ? (<>
                <td className="n c-total">{rupees(c.outstanding)}</td>
                <td className="n c-date">{c.overdueCount > 0 ? <span className="chip cancelled">{rupees(c.overdue)} ({c.overdueCount})</span> : <span className="muted">None</span>}</td>
                <td className="n c-type">{c.drafts}</td>
              </>) : <td colSpan={3} className="muted c-cust">Your role cannot see figures for this business.</td>}
              <td className="c-cust">{c.deadlines.length === 0 ? <span className="muted">None tracked</span> : c.deadlines.map((d) => (
                <div key={d.form} style={{ fontSize: 13 }}>{d.form} for {d.period}: <b style={{ color: d.daysLeft >= 0 && d.daysLeft <= 5 ? 'var(--warning)' : d.daysLeft < 0 ? 'var(--text-muted)' : undefined }}>{d.due}</b> ({when(d.daysLeft)})</div>))}</td>
              <td className="n c-status"><button className="secondary sm" onClick={() => open(c.businessId)} aria-label={`Open ${c.name}`}>Open</button></td>
            </tr>))}</tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>GST dates are the standard monthly ones (GSTR-1 on the 11th, GSTR-3B on the 20th). Quarterly filers and extended dates are not tracked here, so check the portal before relying on them.</p>
    </>
  );
}
