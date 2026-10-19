'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../../../lib/client';

type Entry = { id: string; kind: 'time' | 'expense' | 'fee'; entry_date: string; description: string; minutes: number | null; rate_paise: string | null; amount_paise: string; billable: boolean; pure_agent: boolean; invoiced_document_id: string | null; invoice_number: string | null; invoice_status: string | null };
type Fund = { id: string; entry_date: string; kind: 'deposit' | 'refund' | 'applied'; amount_paise: string; note: string | null };
type Ev = { id: string; event_date: string; kind: 'hearing' | 'deadline' | 'other'; title: string; notes: string | null; done: boolean };
type Person = { user_id: string; role: string; who: string; listed: boolean };
type Detail = {
  matter: { id: string; title: string; reference: string | null; status: 'open' | 'closed'; rate_paise: string; sac: string; reverse_charge: boolean; tds_bp: number; notes: string | null; opened_on: string; party_name: string; party_gstin: string | null; restricted: boolean };
  entries: Entry[]; funds: Fund[]; events: Ev[]; payable: { id: string; number: string; doc_date: string; outstanding_paise: string }[]; unbilled: { amountPaise: string; minutes: number; count: number }; heldPaise: string;
};
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const FUND_LABEL = { deposit: 'Received', refund: 'Returned', applied: 'Kept for an invoice' } as const;

export default function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [tm, setTm] = useState({ duration: '', description: '', date: '', rate: '' });
  const [ex, setEx] = useState({ description: '', amount: '', date: '', pureAgent: false });
  const [fd, setFd] = useState({ kind: 'deposit', amount: '', note: '' });
  const [fee, setFee] = useState({ description: '', amount: '', date: '' });
  const [pay, setPay] = useState({ documentId: '', amount: '' });
  const [ev, setEv] = useState({ date: '', title: '', kind: 'hearing' });
  const [access, setAccess] = useState<{ restricted: boolean; people: Person[] } | null>(null);

  const load = useCallback(async () => { setD(await api(`/api/matters/${id}`)); }, [id]);
  const loadAccess = useCallback(async () => { setAccess(await api(`/api/matters/${id}/access`)); }, [id]);
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    api('/api/business').then((b) => { setRole(b.role); if (b.role === 'owner') loadAccess().catch(() => {}); });
  }, [load, loadAccess]);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (!d) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  const m = d.matter;
  const canWrite = role === 'owner' || role === 'staff';
  const open = m.status === 'open';

  return (
    <>
      <div className="doc-head">
        <div>
          <h1>{m.title}</h1>
          <div className="meta"><span className={`chip ${open ? 'issued' : 'cancelled'}`}>{open ? 'Open' : 'Closed'}</span><span>{m.party_name}{m.reference ? ` · ${m.reference}` : ''} · opened {m.opened_on} · Rs {(Number(m.rate_paise) / 100).toLocaleString('en-IN')} an hour</span></div>
        </div>
        <div className="doc-amount">
          <div className="big" data-testid="unbilled">{rupees(d.unbilled.amountPaise)}</div>
          <div className="muted">{d.unbilled.count} unbilled {d.unbilled.count === 1 ? 'entry' : 'entries'}{d.unbilled.minutes ? ` · ${hm(d.unbilled.minutes)}` : ''}</div>
        </div>
        <div className="row doc-actions">
          <a className="btn secondary" href="/app/matters">Back</a>
          {canWrite && d.unbilled.count > 0 && <button disabled={busy} onClick={() => run(async () => { const r = await api(`/api/matters/${id}/bill`, { body: {} }); window.location.href = `/app/invoices/${r.id}`; })}>Create draft invoice</button>}
          {canWrite && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/matters/${id}`, { method: 'PATCH', body: { status: open ? 'closed' : 'open' } }); await load(); })}>{open ? 'Close matter' : 'Reopen matter'}</button>}
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {(m.reverse_charge || m.tds_bp > 0) && <p className="muted" style={{ fontSize: 13 }}>Invoices from this matter carry {m.reverse_charge ? 'reverse charge' : ''}{m.reverse_charge && m.tds_bp > 0 ? ' and ' : ''}{m.tds_bp > 0 ? `${m.tds_bp / 100}% TDS` : ''}, as set on the matter. SAC {m.sac}.</p>}

      <div className="doc-layout">
        <div>
          {canWrite && open && (
            <div className="panel">
              <p className="section-label">Record time</p>
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/matters/${id}/time`, { body: { duration: tm.duration, description: tm.description, date: tm.date || undefined, rate: tm.rate || undefined } }); setTm({ duration: '', description: '', date: '', rate: '' }); setMsg('Time recorded.'); await load(); }); }}>
                <div className="row">
                  <div><label htmlFor="td" style={{ marginTop: 0 }}>Time</label><input id="td" value={tm.duration} placeholder="1:30 or 90m or 1.5" onChange={(e) => setTm({ ...tm, duration: e.target.value })} required /></div>
                  <div><label htmlFor="tdt" style={{ marginTop: 0 }}>Date</label><input id="tdt" type="date" value={tm.date} onChange={(e) => setTm({ ...tm, date: e.target.value })} /></div>
                  <div><label htmlFor="tr" style={{ marginTop: 0 }}>Rate (Rs an hour, if different)</label><input id="tr" inputMode="decimal" value={tm.rate} onChange={(e) => setTm({ ...tm, rate: e.target.value })} /></div>
                </div>
                <label htmlFor="tde">What was done</label>
                <input id="tde" value={tm.description} maxLength={300} placeholder="For example, drafting the written statement" onChange={(e) => setTm({ ...tm, description: e.target.value })} required />
                <button disabled={busy} style={{ marginTop: 12 }}>Add time</button>
              </form>
            </div>)}
          {canWrite && open && (
            <div className="panel">
              <p className="section-label">Record an expense</p>
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/matters/${id}/expense`, { body: { description: ex.description, amount: ex.amount, date: ex.date || undefined, pureAgent: ex.pureAgent } }); setEx({ description: '', amount: '', date: '', pureAgent: false }); setMsg('Expense recorded.'); await load(); }); }}>
                <div className="row">
                  <div style={{ flex: 2 }}><label htmlFor="ed" style={{ marginTop: 0 }}>What it was for</label><input id="ed" value={ex.description} maxLength={300} placeholder="Court fee, stamp duty, courier" onChange={(e) => setEx({ ...ex, description: e.target.value })} required /></div>
                  <div><label htmlFor="ea" style={{ marginTop: 0 }}>Amount (Rs)</label><input id="ea" inputMode="decimal" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} required /></div>
                  <div><label htmlFor="edt" style={{ marginTop: 0 }}>Date</label><input id="edt" type="date" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></div>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={ex.pureAgent} onChange={(e) => setEx({ ...ex, pureAgent: e.target.checked })} /> Paid on the client&apos;s behalf, passed on at cost with no GST</label>
                <p className="muted" style={{ fontSize: 13 }}>Only tick this when it is a true pure-agent expense. If unsure, leave it unticked and ask your CA.</p>
                <button disabled={busy}>Add expense</button>
              </form>
            </div>)}

          {canWrite && open && (
            <div className="panel">
              <p className="section-label">Record a fixed fee</p>
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/matters/${id}/fee`, { body: { description: fee.description, amount: fee.amount, date: fee.date || undefined } }); setFee({ description: '', amount: '', date: '' }); setMsg('Fee recorded.'); await load(); }); }}>
                <div className="row">
                  <div style={{ flex: 2 }}><label htmlFor="fe" style={{ marginTop: 0 }}>Fee for</label><input id="fe" value={fee.description} maxLength={300} placeholder="Retainer for October, or fee for filing the suit" onChange={(e) => setFee({ ...fee, description: e.target.value })} required /></div>
                  <div><label htmlFor="fea" style={{ marginTop: 0 }}>Fee (Rs, before GST)</label><input id="fea" inputMode="decimal" value={fee.amount} onChange={(e) => setFee({ ...fee, amount: e.target.value })} required /></div>
                  <div><label htmlFor="fed" style={{ marginTop: 0 }}>Date</label><input id="fed" type="date" value={fee.date} onChange={(e) => setFee({ ...fee, date: e.target.value })} /></div>
                </div>
                <button disabled={busy} style={{ marginTop: 12 }}>Add fee</button>
              </form>
            </div>)}

          <div className="panel">
            <p className="section-label">Time and expenses</p>
            {d.entries.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
              <table className="t" aria-label="Entries">
                <thead><tr><th>Date</th><th>Entry</th><th className="n">Amount</th><th>Billing</th><th /></tr></thead>
                <tbody>{d.entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                    <td>{e.description}<br /><span className="muted" style={{ fontSize: 12.5 }}>{e.kind === 'time' ? `${hm(e.minutes ?? 0)} at Rs ${(Number(e.rate_paise) / 100).toLocaleString('en-IN')} an hour` : e.kind === 'fee' ? 'Fixed fee' : e.pure_agent ? 'Expense, at cost' : 'Expense'}</span></td>
                    <td className="n">{rupees(e.amount_paise)}</td>
                    <td>{e.invoiced_document_id ? <a href={`/app/invoices/${e.invoiced_document_id}`}>{e.invoice_number ?? 'Draft invoice'}</a> : e.billable ? 'To bill' : <span className="muted">Not billed</span>}</td>
                    <td className="n">{canWrite && !e.invoiced_document_id && (<>
                      <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/matters/entries/${e.id}`, { method: 'PATCH', body: { billable: !e.billable } }); await load(); })}>{e.billable ? 'Do not bill' : 'Bill'}</button>{' '}
                      <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/matters/entries/${e.id}`, { method: 'DELETE' }); await load(); })}>Remove</button></>)}</td>
                  </tr>))}</tbody>
              </table>)}
          </div>
        </div>

        <div className="doc-side">
          <div className="panel" aria-label="Client money">
            <h2>Client money</h2>
            <p>Held for the client: <b data-testid="held">{rupees(d.heldPaise)}</b></p>
            <p className="muted" style={{ fontSize: 13 }}>Money received in advance for this matter. Entries cannot be edited. A mistake is fixed with another entry. The rules for holding client money are set by your bar council, so check them before you rely on this ledger.</p>
            {canWrite && (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/matters/${id}/funds`, { body: { kind: fd.kind, amount: fd.amount, note: fd.note || undefined } }); setFd({ kind: fd.kind, amount: '', note: '' }); await load(); }); }}>
                <div className="row">
                  <div><label htmlFor="fk">What happened</label>
                    <select id="fk" value={fd.kind} onChange={(e) => setFd({ ...fd, kind: e.target.value })}><option value="deposit">Received from client</option><option value="refund">Returned to client</option></select></div>
                  <div><label htmlFor="fa">Amount (Rs)</label><input id="fa" inputMode="decimal" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} required /></div>
                </div>
                <label htmlFor="fn">Note (cheque number, reference)</label>
                <input id="fn" value={fd.note} maxLength={300} onChange={(e) => setFd({ ...fd, note: e.target.value })} />
                <button disabled={busy} style={{ marginTop: 12 }}>Record</button>
              </form>)}
            {canWrite && BigInt(d.heldPaise) > 0n && d.payable.length > 0 && (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api(`/api/matters/${id}/pay`, { body: { documentId: pay.documentId, amount: pay.amount || undefined } }); setPay({ documentId: '', amount: '' }); setMsg(`Paid ${rupees(r.paidPaise)} from money held.`); await load(); }); }} style={{ marginTop: 14 }}>
                <p className="section-label">Pay an invoice from this money</p>
                <label htmlFor="pi" style={{ marginTop: 0 }}>Invoice</label>
                <select id="pi" value={pay.documentId} onChange={(e) => setPay({ ...pay, documentId: e.target.value })} required>
                  <option value="">Choose an invoice</option>{d.payable.map((x) => <option key={x.id} value={x.id}>{x.number} ({rupees(x.outstanding_paise)} due)</option>)}</select>
                <label htmlFor="pia">Amount (Rs, blank for as much as is due)</label>
                <input id="pia" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                <button disabled={busy} style={{ marginTop: 12 }}>Pay invoice</button>
              </form>)}
            {d.funds.length > 0 && (
              <ul className="plain" style={{ marginTop: 12 }}>{d.funds.map((k) => (
                <li key={k.id}><span>{k.entry_date} · {FUND_LABEL[k.kind]}{k.note ? ` · ${k.note}` : ''}</span><span>{k.kind === 'deposit' ? '+' : '-'}{rupees(k.amount_paise)}</span></li>))}</ul>)}
          </div>
          <div className="panel" aria-label="Hearings and deadlines">
            <h2>Hearings and deadlines</h2>
            {d.events.length === 0 ? <p className="muted">None recorded.</p> : (
              <ul className="plain">{d.events.map((x) => (
                <li key={x.id} style={{ opacity: x.done ? 0.55 : 1 }}>
                  <span><b>{x.event_date}</b> · {x.kind === 'hearing' ? 'Hearing' : x.kind === 'deadline' ? 'Deadline' : 'Date'}: {x.title}{x.done ? ' (done)' : ''}</span>
                  {canWrite && <span>
                    <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/matters/events/${x.id}`, { method: 'PATCH', body: { done: !x.done } }); await load(); })}>{x.done ? 'Undo' : 'Done'}</button>{' '}
                    <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/matters/events/${x.id}`, { method: 'DELETE' }); await load(); })}>Remove</button></span>}
                </li>))}</ul>)}
            {canWrite && open && (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/matters/${id}/events`, { body: { date: ev.date, title: ev.title, kind: ev.kind } }); setEv({ date: '', title: '', kind: ev.kind }); await load(); }); }} style={{ marginTop: 12 }}>
                <div className="row">
                  <div><label htmlFor="evk" style={{ marginTop: 0 }}>Kind</label><select id="evk" value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}><option value="hearing">Hearing</option><option value="deadline">Deadline</option><option value="other">Other</option></select></div>
                  <div><label htmlFor="evd" style={{ marginTop: 0 }}>Date</label><input id="evd" type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} required /></div>
                </div>
                <label htmlFor="evt">What is it?</label>
                <input id="evt" value={ev.title} maxLength={160} placeholder="For example, final arguments" onChange={(e) => setEv({ ...ev, title: e.target.value })} required />
                <button disabled={busy} style={{ marginTop: 12 }}>Add date</button>
              </form>)}
          </div>

          {role === 'owner' && access && (
            <div className="panel" aria-label="Who can see this matter">
              <h2>Who can see this matter</h2>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 0 }}>
                <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={access.restricted} disabled={busy}
                  onChange={(e) => run(async () => { await api(`/api/matters/${id}/access`, { method: 'PUT', body: { restricted: e.target.checked, userIds: access.people.filter((x) => x.listed).map((x) => x.user_id) } }); await loadAccess(); })} />
                Only the people I choose can see this matter
              </label>
              <p className="muted" style={{ fontSize: 13 }}>Owners always can. This covers the matter, its time, its client money and its dates. An invoice made from it is an ordinary invoice, and anyone who can see invoices can read its lines.</p>
              {access.restricted && access.people.filter((x) => x.role !== 'owner').map((x) => (
                <label key={x.user_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={x.listed} disabled={busy}
                    onChange={(e) => run(async () => { await api(`/api/matters/${id}/access`, { method: 'PUT', body: { restricted: true, userIds: access.people.filter((y) => (y.user_id === x.user_id ? e.target.checked : y.listed)).map((y) => y.user_id) } }); await loadAccess(); })} />
                  {x.who} ({x.role})
                </label>))}
            </div>)}
        </div>
      </div>
    </>
  );
}
