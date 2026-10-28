'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../lib/client';

type Row = Record<string, any>;
const TABS = ['Overview', 'Businesses', 'Users', 'Privacy requests', 'Breaches', 'Jobs', 'Admin log'] as const;
type Tab = (typeof TABS)[number];
const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const get = (q: string) => api(`/api/admin/panel?${q}`);
const post = (body: Record<string, unknown>) => api('/api/admin/panel', { body });

/** Kora's staff panel: how the platform is doing, and the few things staff may change. Every change is written to the admin log. */
export default function Admin() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const fail = (e: unknown) => { setErr((e as Error).message); setMsg(''); };
  const ok = (m: string) => { setMsg(m); setErr(''); };
  return (
    <div>
      <h1>Kora admin</h1>
      <nav aria-label="Admin sections" className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {TABS.map((t) => <button key={t} className={t === tab ? '' : 'secondary'} aria-current={t === tab ? 'page' : undefined} onClick={() => { setTab(t); setErr(''); setMsg(''); }}>{t}</button>)}
      </nav>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {tab === 'Overview' && <Overview fail={fail} />}
      {tab === 'Businesses' && <Businesses fail={fail} ok={ok} />}
      {tab === 'Users' && <Users fail={fail} ok={ok} />}
      {tab === 'Privacy requests' && <Privacy fail={fail} ok={ok} />}
      {tab === 'Breaches' && <Breaches fail={fail} ok={ok} />}
      {tab === 'Jobs' && <Jobs fail={fail} ok={ok} />}
      {tab === 'Admin log' && <Log fail={fail} />}
    </div>
  );
}
type P = { fail: (e: unknown) => void; ok?: (m: string) => void };

function useView(q: string, fail: P['fail']) {
  const [d, setD] = useState<any>(null);
  const load = useCallback(() => { get(q).then(setD).catch(fail); }, [q, fail]);
  useEffect(load, [load]);
  return [d, load] as const;
}

function Stat({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return <div className={`stat${bad ? ' danger' : ''}`}><div className="label">{label}</div><div className="value">{value}</div></div>;
}

function Overview({ fail }: P) {
  const [o] = useView('view=overview', fail);
  if (!o) return <p className="muted" role="status">Loading…</p>;
  return (
    <>
      <section className="stats" aria-label="Platform">
        <Stat label="Businesses" value={o.businesses} /><Stat label="People" value={o.users} /><Stat label="New in 30 days" value={o.newBusinesses30d} />
        <Stat label="Issued this month" value={o.issuedThisMonth} /><Stat label="Monthly recurring revenue" value={rupees(BigInt(o.mrrPaise))} />
      </section>
      <section className="stats" aria-label="Needs attention">
        <Stat label="Payment failed (plans)" value={o.pastDue} bad={o.pastDue > 0} />
        <Stat label="Jobs failed" value={o.jobsFailed} bad={o.jobsFailed > 0} />
        <Stat label="Oldest waiting job (min)" value={o.oldestQueuedMinutes} bad={o.oldestQueuedMinutes > 15} />
        <Stat label="Privacy requests open" value={o.privacyOpen} /><Stat label="Privacy requests overdue" value={o.privacyOverdue} bad={o.privacyOverdue > 0} />
        <Stat label="Breaches not fully notified" value={o.breachesOpen} bad={o.breachesOpen > 0} />
        <Stat label="Payments not applied" value={o.unprocessedPayments} bad={o.unprocessedPayments > 0} />
      </section>
      <div className="panel"><h2>Plans</h2><p>{Object.entries(o.plans as Row).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'None'}</p></div>
    </>
  );
}

function Businesses({ fail, ok }: P) {
  const [q, setQ] = useState('');
  const [rows, load] = useView(`view=businesses&q=${encodeURIComponent(q)}`, fail);
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor="bq">Search by name or GSTIN</label>
      <input id="bq" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows ? <p className="muted">Loading…</p> : (
        <table className="t"><thead><tr><th>Business</th><th>GSTIN</th><th>Plan</th><th className="n">People</th><th className="n">Issued</th><th>Since</th><th /></tr></thead>
          <tbody>{(rows as Row[]).map((b) => (
            <tr key={b.id}><td>{b.legal_name}</td><td>{b.gstin}</td><td>{b.plan} <span className="muted">({b.plan_status})</span></td><td className="n">{b.members}</td><td className="n">{b.issued_total}</td><td>{when(b.created_at)}</td>
              <td><button className="link" onClick={() => setSel(b.id)}>Open</button></td></tr>))}</tbody></table>
      )}
      {sel && <BusinessDetail id={sel} fail={fail} ok={(m) => { ok?.(m); load(); }} onClose={() => setSel(null)} />}
    </div>
  );
}

function BusinessDetail({ id, fail, ok, onClose }: { id: string; fail: P['fail']; ok: (m: string) => void; onClose: () => void }) {
  const [d, reload] = useView(`view=business&id=${id}`, fail);
  const [plan, setPlan] = useState('business'), [status, setStatus] = useState('active'), [until, setUntil] = useState(''), [note, setNote] = useState('');
  if (!d) return <p className="muted">Loading…</p>;
  const b = d.business as Row;
  return (
    <div className="panel" aria-label="Business detail">
      <div className="row"><h2>{b.legal_name}</h2><button className="secondary" onClick={onClose}>Close</button></div>
      <p className="muted">{b.gstin} · state {b.state_code} · {b.registration_type} · since {when(b.created_at)}</p>
      <p>Plan: <b>{d.plan?.plan ?? 'starter'}</b> ({d.plan?.status ?? 'free'}){d.plan?.valid_until ? ` to ${when(d.plan.valid_until)}` : ''}{d.plan?.note ? ` · ${d.plan.note}` : ''}</p>
      <p>Issued this month {d.usage.issuedThisMonth} · in total {d.usage.issuedTotal} · parties {d.usage.parties} · failed jobs {d.usage.failedJobs}</p>
      <h3>People</h3>
      <ul>{(d.members as Row[]).map((m) => <li key={m.userId}>{m.who} <span className="muted">({m.role})</span></li>)}</ul>
      <h3>Subscriptions and payments</h3>
      {(d.subscriptions as Row[]).length === 0 ? <p className="muted">None.</p> : <ul>{(d.subscriptions as Row[]).map((s) => <li key={s.id}>{s.plan} · {s.status}{s.current_period_end ? ` · to ${when(s.current_period_end)}` : ''}{s.cancel_at_period_end ? ' · will not renew' : ''}</li>)}</ul>}
      {(d.payments as Row[]).length > 0 && <ul>{(d.payments as Row[]).map((p) => <li key={p.gateway_payment_id}>{when(p.paid_at)} · {rupees(BigInt(p.amount_paise))} · {p.gateway_payment_id}</li>)}</ul>}
      <h3>Set the plan by hand</h3>
      <form onSubmit={(e) => { e.preventDefault(); post({ action: 'plan.set', businessId: id, plan, status, validUntil: until ? new Date(until).toISOString() : null, note }).then(() => { ok('Plan saved and logged.'); reload(); }).catch(fail); }}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div><label htmlFor="pp">Plan</label><select id="pp" value={plan} onChange={(e) => setPlan(e.target.value)}><option>starter</option><option>business</option><option>firm</option></select></div>
          <div><label htmlFor="ps">Status</label><select id="ps" value={status} onChange={(e) => setStatus(e.target.value)}><option>free</option><option>trialing</option><option>active</option><option>past_due</option><option>cancelled</option></select></div>
          <div><label htmlFor="pu">Paid to</label><input id="pu" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
        </div>
        <label htmlFor="pn">Why (goes in the admin log)</label>
        <input id="pn" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={500} />
        <button style={{ marginTop: 8 }}>Save plan</button>
      </form>
    </div>
  );
}

function Users({ fail, ok }: P) {
  const [q, setQ] = useState('');
  const [rows, load] = useView(`view=users&q=${encodeURIComponent(q)}`, fail);
  return (
    <div>
      <label htmlFor="uq">Search by name, e-mail or number</label>
      <input id="uq" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows ? <p className="muted">Loading…</p> : (
        <table className="t"><thead><tr><th>Person</th><th>Account</th><th className="n">Businesses</th><th className="n">Devices</th><th>Authenticator</th><th>Since</th><th /></tr></thead>
          <tbody>{(rows as Row[]).map((u) => (
            <tr key={u.id}><td>{u.deleted_at ? <i>closed</i> : (u.email ?? u.phone)}<div className="muted">{u.display_name}</div></td><td>{u.account_type}{u.locked_until && new Date(u.locked_until) > new Date() ? ' · locked' : ''}</td>
              <td className="n">{u.businesses}</td><td className="n">{u.active_sessions}</td><td>{u.has_mfa ? 'on' : 'off'}</td><td>{when(u.created_at)}</td>
              <td><button className="link" onClick={() => { if (confirm('Sign this person out everywhere and clear any lock?')) post({ action: 'sessions.revoke', userId: u.id }).then((r) => { ok?.(`Signed out ${r.revoked} device(s).`); load(); }).catch(fail); }}>Sign out everywhere</button></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

function Privacy({ fail, ok }: P) {
  const [openOnly, setOpenOnly] = useState(true);
  const [rows, load] = useView(`view=privacy&open=${openOnly ? 1 : 0}`, fail);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const act = (id: string, status: string) => post({ action: 'privacy.resolve', id, status, resolution: answer[id] ?? '' }).then(() => { ok?.('Saved.'); load(); }).catch(fail);
  return (
    <div>
      <label><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Only open requests</label>
      {!rows ? <p className="muted">Loading…</p> : (rows as Row[]).length === 0 ? <p className="muted">Nothing to show.</p> : (
        <table className="t"><thead><tr><th>Who</th><th>Request</th><th>Due</th><th>Status</th><th>Answer</th></tr></thead>
          <tbody>{(rows as Row[]).map((r) => (
            <tr key={r.id}><td>{r.who}</td><td><b>{r.kind}</b><div className="muted">{r.details}</div></td><td style={r.overdue ? { color: 'var(--danger, #b00020)' } : undefined}>{when(r.due_at)}{r.overdue ? ' · overdue' : ''}</td><td>{r.status}</td>
              <td>{r.resolved_at ? r.resolution : (
                <><textarea aria-label="Answer the person will see" rows={2} value={answer[r.id] ?? ''} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} />
                  <div className="row" style={{ justifyContent: 'flex-start', gap: 6 }}><button className="secondary" onClick={() => void act(r.id, 'in_progress')}>Being looked at</button><button onClick={() => void act(r.id, 'done')}>Done</button><button className="secondary" onClick={() => void act(r.id, 'rejected')}>Cannot do</button></div></>)}</td></tr>))}</tbody></table>
      )}
    </div>
  );
}

function Breaches({ fail, ok }: P) {
  const [rows, load] = useView('view=breaches', fail);
  const [f, setF] = useState({ discoveredAt: '', summary: '', dataAffected: '', peopleAffected: '' });
  return (
    <div>
      <p className="muted">Under the DPDP Act a personal data breach must be reported to the Data Protection Board and to the people affected. Record it here the day you find it, and the dates you tell them.</p>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); post({ action: 'breach.record', ...f, discoveredAt: new Date(f.discoveredAt).toISOString() }).then(() => { ok?.('Recorded.'); setF({ discoveredAt: '', summary: '', dataAffected: '', peopleAffected: '' }); load(); }).catch(fail); }}>
        <h2>Record a breach</h2>
        <label htmlFor="bd">When it was found</label><input id="bd" type="datetime-local" required value={f.discoveredAt} onChange={(e) => setF({ ...f, discoveredAt: e.target.value })} />
        <label htmlFor="bs">What happened</label><textarea id="bs" rows={3} required value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        <label htmlFor="ba">What data</label><input id="ba" value={f.dataAffected} onChange={(e) => setF({ ...f, dataAffected: e.target.value })} />
        <label htmlFor="bp">People affected (if known)</label><input id="bp" type="number" min={0} value={f.peopleAffected} onChange={(e) => setF({ ...f, peopleAffected: e.target.value })} />
        <button style={{ marginTop: 8 }}>Record</button>
      </form>
      {!rows ? <p className="muted">Loading…</p> : (rows as Row[]).map((b) => (
        <div key={b.id} className="panel">
          <p><b>{when(b.discovered_at)}</b> · {b.contained ? 'contained' : 'not contained yet'} · {b.people_affected ?? '?'} people</p>
          <p>{b.summary}</p>
          <p className="muted">Board told: {b.board_notified_at ? when(b.board_notified_at) : 'not yet'} · People told: {b.people_notified_at ? when(b.people_notified_at) : 'not yet'}</p>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 6 }}>
            {!b.contained && <button className="secondary" onClick={() => post({ action: 'breach.update', id: b.id, contained: true }).then(load).catch(fail)}>Mark contained</button>}
            {!b.board_notified_at && <button className="secondary" onClick={() => post({ action: 'breach.update', id: b.id, boardNotifiedAt: new Date().toISOString() }).then(load).catch(fail)}>Board told now</button>}
            {!b.people_notified_at && <button className="secondary" onClick={() => post({ action: 'breach.update', id: b.id, peopleNotifiedAt: new Date().toISOString() }).then(load).catch(fail)}>People told now</button>}
          </div>
        </div>))}
    </div>
  );
}

function Jobs({ fail, ok }: P) {
  const [d, load] = useView('view=jobs', fail);
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <div>
      <table className="t"><thead><tr><th>Queue</th><th>Status</th><th className="n">Jobs</th><th>Oldest waiting</th></tr></thead>
        <tbody>{(d.counts as Row[]).map((c, i) => <tr key={i}><td>{c.queue}</td><td>{c.status}</td><td className="n">{c.n}</td><td>{when(c.oldest_waiting)}</td></tr>)}</tbody></table>
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>Failed</h2>{d.failed.length > 0 && <button onClick={() => { if (confirm('Put every failed job back in line?')) post({ action: 'jobs.retry' }).then((r) => { ok?.(`${r.requeued} put back in line.`); load(); }).catch(fail); }}>Retry all failed</button>}</div>
      {d.failed.length === 0 ? <p className="muted">None.</p> : (
        <table className="t"><thead><tr><th>Queue</th><th>Tries</th><th>Last error</th><th>When</th></tr></thead>
          <tbody>{(d.failed as Row[]).map((j) => <tr key={j.id}><td>{j.queue}</td><td className="n">{j.attempts}</td><td>{String(j.last_error ?? '').slice(0, 200)}</td><td>{when(j.updated_at)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}

function Log({ fail }: P) {
  const [rows] = useView('view=audit', fail);
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <table className="t"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
      <tbody>{(rows as Row[]).map((r) => <tr key={r.id}><td>{when(r.created_at)}</td><td>{r.admin}</td><td>{r.action}</td><td className="muted">{r.target}</td><td className="muted">{JSON.stringify(r.detail)}</td></tr>)}</tbody></table>
  );
}
