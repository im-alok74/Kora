'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Icon from '../../../components/Icon';
import { api, rupees } from '../../../lib/client';

type Row = { id: string; title: string; reference: string | null; status: 'open' | 'closed'; rate_paise: string; opened_on: string; party_name: string; unbilled_paise: string; unbilled_minutes: number; held_paise: string };
type Party = { id: string; name: string; kind: string };
type Ev = { id: string; matter_id: string; event_date: string; kind: string; title: string; matter_title: string; matter_reference: string | null; days_left: number };
const when = (n: number) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/** Cases or engagements, each with its client, an hourly rate, and what is still to be billed. */
export default function Matters() {
  // The same screen serves legal matters and freelance projects: the address says which.
  const isProject = (usePathname() ?? '').startsWith('/app/projects');
  const kind = isProject ? 'project' : 'matter';
  const base = isProject ? '/app/projects' : '/app/matters';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [role, setRole] = useState('');
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ partyId: '', title: '', reference: '', rate: '', reverseCharge: false, tds: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setRows((await api(`/api/matters?kind=${kind}&status=${tab}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)).matters); }, [tab, q, kind]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  useEffect(() => { api(`/api/matters/events?days=30&kind=${kind}`).then((r) => setEvents(r.events)).catch(() => {}); }, [kind]);
  useEffect(() => {
    api('/api/business').then((b) => setRole(b.role));
    api('/api/parties').then((r) => setParties((r.parties as Party[]).filter((p) => p.kind !== 'vendor')));
  }, []);
  const canWrite = role === 'owner' || role === 'staff';

  return (
    <>
      <div className="toolbar">
        <div><h1>{isProject ? 'Projects' : 'Matters'}</h1><p className="page-sub">{isProject ? 'Each piece of client work, with the time, fees and expenses that are still to be billed.' : 'Each case or engagement, with the time and expenses that are still to be billed.'}</p></div>
        {canWrite && <button onClick={() => setAdding((v) => !v)}><Icon name="plus" size={18} />{isProject ? 'New project' : 'New matter'}</button>}
      </div>

      {adding && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); setErr(''); setBusy(true);
          api('/api/matters', { body: { kind, partyId: f.partyId, title: f.title, reference: f.reference || null, rate: f.rate || null, reverseCharge: f.reverseCharge, tdsBp: f.tds ? Math.round(Number(f.tds) * 100) : 0 } })
            .then((r) => { window.location.href = `${base}/${r.id}`; }).catch((x) => { setErr(x.message); setBusy(false); }); }}>
          <p className="section-label">{isProject ? 'New project' : 'New matter'}</p>
          <div className="row">
            <div><label htmlFor="mc" style={{ marginTop: 0 }}>Client</label>
              <select id="mc" value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} required>
                <option value="">Choose a client</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div style={{ flex: 2 }}><label htmlFor="mt" style={{ marginTop: 0 }}>{isProject ? 'Project name' : 'Matter title'}</label><input id="mt" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} required /></div>
          </div>
          <div className="row">
            <div><label htmlFor="mr">{isProject ? 'Reference (optional)' : 'Case or file number (optional)'}</label><input id="mr" value={f.reference} maxLength={60} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
            <div><label htmlFor="mh">Hourly rate (Rs)</label><input id="mh" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
            <div><label htmlFor="md">TDS the client deducts (%)</label><input id="md" inputMode="decimal" value={f.tds} placeholder="0" onChange={(e) => setF({ ...f, tds: e.target.value })} /></div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={f.reverseCharge} onChange={(e) => setF({ ...f, reverseCharge: e.target.checked })} /> Tax is payable by the client (reverse charge)</label>
          <p className="muted" style={{ fontSize: 13 }}>Whether reverse charge or TDS applies depends on who your client is. Check with your CA before you rely on either setting.</p>
          {err && <p className="error" role="alert">{err}</p>}
          <button disabled={busy}>{isProject ? 'Create project' : 'Create matter'}</button>
        </form>
      )}
      {!adding && err && <p className="error" role="alert">{err}</p>}

      {events.length > 0 && (
        <div className="panel" aria-label="Coming up">
          <p className="section-label">Coming up in the next 30 days</p>
          <ul className="plain">{events.slice(0, 8).map((e) => (
            <li key={e.id}><span><b>{e.event_date}</b> · {e.kind === 'hearing' ? 'Hearing' : e.kind === 'deadline' ? 'Deadline' : 'Date'}: {e.title} <a href={`${base}/${e.matter_id}`}>{e.matter_reference ?? e.matter_title}</a></span>
              <span className={e.days_left < 0 ? 'error' : 'muted'}>{when(e.days_left)}</span></li>))}</ul>
        </div>)}

      <div className="tabs" role="group" aria-label={isProject ? 'Project status' : 'Matter status'}>
        {(['open', 'closed'] as const).map((k) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{k === 'open' ? 'Open' : 'Closed'}</button>)}
      </div>
      <div className="filters"><div style={{ flex: 1 }}><label htmlFor="mq">Search</label><input id="mq" type="search" placeholder="Title, file number or client" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>

      {rows === null && !err && <p className="muted" role="status">Loading</p>}
      {rows && rows.length === 0 && (
        <div className="panel empty"><Icon name="documents" size={34} style={{ color: 'var(--text-faint)' }} /><h3>{isProject ? 'No projects here.' : 'No matters here.'}</h3><p>{tab === 'open' ? 'Create a matter to start recording time and expenses against a client.' : 'Closed matters appear here.'}</p></div>)}
      {rows && rows.length > 0 && (
        <table className="t cards" aria-label={isProject ? 'Projects' : 'Matters'}>
          <thead><tr><th>{isProject ? 'Project' : 'Matter'}</th><th>Client</th><th className="n">Unbilled time</th><th className="n">Unbilled</th><th className="n">{isProject ? 'Advance held' : 'Held for client'}</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td className="c-num"><a href={`${base}/${m.id}`}>{m.title}</a>{m.reference && <><br /><span className="muted">{m.reference}</span></>}</td>
              <td className="c-cust">{m.party_name}</td>
              <td className="n c-date">{m.unbilled_minutes ? hm(m.unbilled_minutes) : <span className="muted">None</span>}</td>
              <td className="n c-total">{BigInt(m.unbilled_paise) > 0n ? rupees(m.unbilled_paise) : <span className="muted">Nil</span>}</td>
              <td className="n c-type">{BigInt(m.held_paise) > 0n ? rupees(m.held_paise) : <span className="muted">Nil</span>}</td>
            </tr>))}</tbody>
        </table>)}
    </>
  );
}
