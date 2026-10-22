'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, rupees, TAX_RATES } from '../../../lib/client';
import EmptyState from '../../../components/EmptyState';

type Preview = { active: boolean; mode: string; channel: string | null; amountPaise: string; dates: { date: string; dueDate: string | null }[] };
const MODE_HELP: Record<string, string> = {
  draft: 'Kora makes the invoice on its date and leaves it as a draft. You check it and issue it yourself.',
  issue: 'Kora makes the invoice and issues it on its date. It is not sent to the customer unless you send it.',
  issue_and_send: 'Kora makes the invoice, issues it and sends it to the customer on its date. You do nothing.',
};

type Row = { id: string; name: string; doc_type: string; every_n: number; unit: string; start_date: string; end_date: string | null; next_run_date: string;
  mode: string; channel: string | null; active: boolean; party_id: string; party_name: string; created: number; failed: number };
type Run = { id: string; run_date: string; status: string; note: string | null; document_id: string | null; number: string | null; document_status: string | null };
type Line = { name: string; hsnSac: string; quantity: string; rate: string; taxRateBp: number };
type Party = { id: string; name: string };
type ExpRow = { id: string; name: string; every_n: number; unit: string; start_date: string; end_date: string | null; next_run_date: string;
  active: boolean; category: string; vendor: string | null; amount_paise: string; gst_paise: string; paid_via: string; created: number; failed: number };
type ExpRun = { id: string; run_date: string; status: string; note: string | null; expense_id: string | null };

const UNIT: Record<string, [string, string]> = { week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };
const MODE: Record<string, string> = { draft: 'Save as a draft', issue: 'Issue automatically', issue_and_send: 'Issue and send' };
const every = (n: number, u: string) => (n === 1 ? `Every ${UNIT[u]![0]}` : `Every ${n} ${UNIT[u]![1]}`);
const blankLine = (): Line => ({ name: '', hsnSac: '', quantity: '1', rate: '', taxRateBp: 1800 });
const today = () => new Date().toLocaleDateString('en-CA');
const CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Travel', 'Office supplies', 'Software and subscriptions', 'Professional fees', 'Marketing',
  'Repairs and maintenance', 'Bank charges', 'Purchases for resale', 'Other'];
const PAID: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', cheque: 'Cheque', other: 'Other' };
const BLANK_EXP = { name: '', category: 'Rent', vendor: '', amount: '', gst: '', paidVia: 'bank_transfer', unit: 'month', everyN: 1, startDate: '', endDate: '', notes: '' };
const BLANK = { name: '', partyId: '', unit: 'month', everyN: 1, startDate: today(), endDate: '', mode: 'draft', channel: 'whatsapp', termsDays: 15, notes: '' };

export default function Recurring() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [role, setRole] = useState('');
  const [form, setForm] = useState(BLANK);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [open, setOpen] = useState(false);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [formDates, setFormDates] = useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [exps, setExps] = useState<ExpRow[] | null>(null);
  const [expForm, setExpForm] = useState({ ...BLANK_EXP, startDate: today() });
  const [expOpen, setExpOpen] = useState(false);
  const [openExpRuns, setOpenExpRuns] = useState<string | null>(null);
  const [expRuns, setExpRuns] = useState<ExpRun[]>([]);
  const canWrite = role === 'owner' || role === 'staff';

  const load = useCallback(async () => {
    setRows((await api('/api/recurring')).recurring);
    setExps((await api('/api/recurring-expenses')).recurringExpenses);
  }, []);
  useEffect(() => {
    void load().catch((e) => setErr(e.message));
    api('/api/parties').then((r) => setParties(r.parties));
    api('/api/business').then((b) => setRole(b.role));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setMsg(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  // While the form is open, show the dates the schedule would run on, so a wrong start date or period is obvious before saving.
  useEffect(() => {
    if (!open || !form.startDate) { setFormDates([]); return; }
    const h = setTimeout(() => {
      api('/api/recurring/dates', { body: { startDate: form.startDate, everyN: Number(form.everyN), unit: form.unit, endDate: form.endDate || null } })
        .then((r) => setFormDates(r.dates)).catch(() => setFormDates([]));
    }, 250);
    return () => clearTimeout(h);
  }, [open, form.startDate, form.everyN, form.unit, form.endDate]);
  const showPlan = async (id: string) => {
    if (openPlan === id) { setOpenPlan(null); return; }
    setPlan(await api(`/api/recurring/${id}/preview?count=6`)); setOpenPlan(id);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const showRuns = async (id: string) => {
    if (openRuns === id) { setOpenRuns(null); return; }
    setRuns((await api(`/api/recurring/${id}`)).runs); setOpenRuns(id);
  };

  const showExpRuns = async (id: string) => {
    if (openExpRuns === id) { setOpenExpRuns(null); return; }
    setExpRuns((await api(`/api/recurring-expenses/${id}`)).runs); setOpenExpRuns(id);
  };
  const createExpense = () => run(async () => {
    await api('/api/recurring-expenses', { body: {
      name: expForm.name, category: expForm.category, vendor: expForm.vendor || null, amount: expForm.amount, gst: expForm.gst || null,
      paidVia: expForm.paidVia, unit: expForm.unit, everyN: Number(expForm.everyN), startDate: expForm.startDate,
      endDate: expForm.endDate || null, notes: expForm.notes || null,
    } });
    setExpForm({ ...BLANK_EXP, startDate: today() }); setExpOpen(false); await load(); setMsg('Recurring expense saved.');
  });

  const create = () => run(async () => {
    await api('/api/recurring', { body: {
      name: form.name, partyId: form.partyId, unit: form.unit, everyN: Number(form.everyN), startDate: form.startDate, endDate: form.endDate || null,
      mode: form.mode, channel: form.mode === 'issue_and_send' ? form.channel : null, termsDays: Number(form.termsDays), notes: form.notes || null,
      lines: lines.filter((l) => l.name.trim() || l.rate).map((l) => ({ name: l.name, hsnSac: l.hsnSac || null, quantity: l.quantity || '0', rate: l.rate || '0', taxRateBp: l.taxRateBp })),
    } });
    setForm(BLANK); setLines([blankLine()]); setOpen(false); await load(); setMsg('Recurring invoice saved.');
  });

  return (
    <>
      <div className="toolbar">
        <h1>Recurring invoices</h1>
        {canWrite && !open && <button onClick={() => setOpen(true)}>New recurring invoice</button>}
      </div>
      <p className="muted">Invoice a customer on a schedule: weekly, monthly or yearly. Kora makes each invoice on its date, as a draft for you to check, or issued and sent for you.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      {open && canWrite && (
        <form className="panel" aria-label="New recurring invoice" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <h2>New recurring invoice</h2>
          <div className="row">
            <div><label htmlFor="rn">Name</label><input id="rn" placeholder="Monthly retainer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label htmlFor="rp">Customer</label>
              <select id="rp" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })} required>
                <option value="">Choose a customer</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </div>
          <div className="row">
            <div><label htmlFor="re">Repeat every</label><input id="re" type="number" min={1} max={24} value={form.everyN} onChange={(e) => setForm({ ...form, everyN: Number(e.target.value) })} /></div>
            <div><label htmlFor="ru">Period</label>
              <select id="ru" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></select></div>
            <div><label htmlFor="rs">First invoice on</label><input id="rs" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></div>
            <div><label htmlFor="rx">Stop after (optional)</label><input id="rx" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="rm">On each date</label>
              <select id="rm" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {form.mode === 'issue_and_send' && (
              <div><label htmlFor="rc">Send by</label>
                <select id="rc" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></div>)}
            <div><label htmlFor="rt">Payment due after (days)</label><input id="rt" type="number" min={0} max={365} value={form.termsDays} onChange={(e) => setForm({ ...form, termsDays: Number(e.target.value) })} /></div>
          </div>

          <p className="muted" data-testid="mode-help">{MODE_HELP[form.mode]}</p>
          {formDates.length > 0 && <p className="muted" data-testid="form-dates">The first dates: {formDates.join(', ')}{form.endDate ? '' : ' and so on'}.</p>}

          <h3 style={{ marginTop: 16 }}>What to invoice</h3>
          <table className="t"><thead><tr><th>Description</th><th>HSN or SAC</th><th>Qty</th><th>Rate (Rs)</th><th>GST</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td><input aria-label={`Line ${i + 1} description`} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                <td><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(i, { taxRateBp: Number(e.target.value) })}>
                  {TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td>{lines.length > 1 && <button type="button" className="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>))}</tbody></table>
          <button type="button" className="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add a line</button>
          <label htmlFor="rno">Notes on each invoice (optional)</label>
          <textarea id="rno" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button disabled={busy}>Save recurring invoice</button>
            <button type="button" className="secondary" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          </div>
        </form>)}

      {rows && rows.length === 0 && !open && (
        <EmptyState icon="repeat" title="No recurring invoices yet">Set one up for a customer you bill every week, month or year. Kora then makes each invoice for you.</EmptyState>)}
      {rows && rows.length > 0 && (
        <table className="t">
          <thead><tr><th>Name</th><th>Customer</th><th>Repeats</th><th>Next invoice</th><th>On each date</th><th className="n">Made</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.name} {!r.active && <span className="chip cancelled">{r.end_date && r.next_run_date > r.end_date ? 'Finished' : 'Paused'}</span>}</td>
                <td>{r.party_name}</td>
                <td>{every(r.every_n, r.unit)}</td>
                <td>{r.active ? r.next_run_date : ''}</td>
                <td>{MODE[r.mode]}{r.mode === 'issue_and_send' ? ` by ${r.channel}` : ''}</td>
                <td className="n">{r.created}{r.failed > 0 && <span className="error"> ({r.failed} failed)</span>}</td>
                <td className="n">
                  <button className="link" onClick={() => void showPlan(r.id)}>{openPlan === r.id ? 'Hide schedule' : 'Schedule'}</button>{' '}
                  <button className="link" onClick={() => void showRuns(r.id)}>{openRuns === r.id ? 'Hide history' : 'History'}</button>
                  {canWrite && (<>{' '}
                    <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/recurring/${r.id}/active`, { body: { active: !r.active } }); await load(); })}>{r.active ? 'Pause' : 'Resume'}</button>{' '}
                    <button className="link" disabled={busy} onClick={() => { if (confirm(`Delete "${r.name}"? Invoices already made are kept.`)) void run(async () => { await api(`/api/recurring/${r.id}`, { method: 'DELETE' }); await load(); }); }}>Delete</button></>)}
                </td>
              </tr>
              {openPlan === r.id && plan && (
                <tr><td colSpan={7}>
                  <div data-testid="schedule-panel">
                    <p><b>{every(r.every_n, r.unit)}</b>{r.end_date ? `, until ${r.end_date}` : ''}. {MODE_HELP[plan.mode]}{plan.mode === 'issue_and_send' ? ` It goes by ${plan.channel}.` : ''}</p>
                    {plan.dates.length === 0 ? <p className="muted">{r.active ? 'No dates are left on this schedule.' : 'This schedule is paused, so nothing is planned. Resume it to see the next dates.'}</p> : (
                      <table className="t" aria-label="Next invoices"><thead><tr><th>Invoice date</th><th>Payment due</th><th className="n">Amount at today&apos;s prices</th></tr></thead>
                        <tbody>{plan.dates.map((x) => <tr key={x.date}><td>{x.date}</td><td>{x.dueDate ?? 'On receipt'}</td><td className="n">{rupees(plan.amountPaise)}</td></tr>)}</tbody></table>)}
                    {canWrite && r.active && (
                      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                        <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => {
                          const out = await api(`/api/recurring/${r.id}/skip`, { body: {} });
                          await load(); setPlan(await api(`/api/recurring/${r.id}/preview?count=6`));
                          setMsg(`Skipped ${out.skipped}. ${out.nextRunDate ? `The next invoice is on ${out.nextRunDate}.` : 'That was the last date, so the schedule is finished.'}`);
                        })}>Skip the next invoice ({r.next_run_date})</button>
                        <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => { await api(`/api/recurring/${r.id}/active`, { body: { active: false } }); await load(); setOpenPlan(null); setMsg('Paused. Nothing will be made until you resume it.'); })}>Pause</button>
                      </div>)}
                  </div>
                </td></tr>)}
              {openRuns === r.id && (
                <tr><td colSpan={7}>
                  {runs.length === 0 ? <span className="muted">Nothing made yet. The first invoice is made on {r.next_run_date}.</span> : (
                    <table className="t"><thead><tr><th>Date</th><th>Result</th><th>Document</th></tr></thead>
                      <tbody>{runs.map((x) => (
                        <tr key={x.id}><td>{x.run_date}</td>
                          <td>{x.status === 'failed' ? <span className="error">Could not make it: {x.note}</span> : x.status === 'skipped' ? <>Skipped. {x.note}</> : <>Made{x.note ? `. ${x.note}` : ''}</>}</td>
                          <td>{x.document_id ? <a href={`/app/invoices/${x.document_id}`}>{x.number ?? 'Draft'}</a> : ''}</td></tr>))}</tbody></table>)}
                </td></tr>)}
            </Fragment>))}</tbody>
        </table>)}

      <div className="toolbar" style={{ marginTop: 32 }}>
        <h2>Recurring expenses</h2>
        {canWrite && !expOpen && <button onClick={() => setExpOpen(true)}>New recurring expense</button>}
      </div>
      <p className="muted">Money that goes out on a schedule: rent, a software subscription, a retainer you pay. Kora records the expense on each date, with the GST you tell it is inside the amount.</p>

      {expOpen && canWrite && (
        <form className="panel" aria-label="New recurring expense" onSubmit={(e) => { e.preventDefault(); void createExpense(); }}>
          <h3>New recurring expense</h3>
          <div className="row">
            <div><label htmlFor="xn">Name</label><input id="xn" placeholder="Shop rent" value={expForm.name} onChange={(e) => setExpForm({ ...expForm, name: e.target.value })} required /></div>
            <div><label htmlFor="xc">Category</label>
              <input id="xc" list="xcl" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} required />
              <datalist id="xcl">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
            <div><label htmlFor="xv">Paid to (optional)</label><input id="xv" value={expForm.vendor} onChange={(e) => setExpForm({ ...expForm, vendor: e.target.value })} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="xa">Amount each time (Rs)</label><input id="xa" inputMode="decimal" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} required /></div>
            <div><label htmlFor="xg">GST inside that (Rs, optional)</label><input id="xg" inputMode="decimal" value={expForm.gst} onChange={(e) => setExpForm({ ...expForm, gst: e.target.value })} /></div>
            <div><label htmlFor="xp">Paid by</label>
              <select id="xp" value={expForm.paidVia} onChange={(e) => setExpForm({ ...expForm, paidVia: e.target.value })}>
                {Object.entries(PAID).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div className="row">
            <div><label htmlFor="xe">Repeat every</label><input id="xe" type="number" min={1} max={24} value={expForm.everyN} onChange={(e) => setExpForm({ ...expForm, everyN: Number(e.target.value) })} /></div>
            <div><label htmlFor="xu">Period</label>
              <select id="xu" value={expForm.unit} onChange={(e) => setExpForm({ ...expForm, unit: e.target.value })}>
                <option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></select></div>
            <div><label htmlFor="xs">First expense on</label><input id="xs" type="date" value={expForm.startDate} onChange={(e) => setExpForm({ ...expForm, startDate: e.target.value })} required /></div>
            <div><label htmlFor="xx">Stop after (optional)</label><input id="xx" type="date" value={expForm.endDate} onChange={(e) => setExpForm({ ...expForm, endDate: e.target.value })} /></div>
          </div>
          <label htmlFor="xno">Notes on each expense (optional)</label>
          <textarea id="xno" value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button disabled={busy}>Save recurring expense</button>
            <button type="button" className="secondary" onClick={() => { setExpOpen(false); setErr(''); }}>Cancel</button>
          </div>
        </form>)}

      {exps && exps.length === 0 && !expOpen && (
        <EmptyState icon="repeat" title="No recurring expenses yet">Set one up for the rent, a subscription, or anything else that goes out on a schedule.</EmptyState>)}
      {exps && exps.length > 0 && (
        <table className="t">
          <thead><tr><th>Name</th><th>Category</th><th>Repeats</th><th>Next expense</th><th className="n">Amount</th><th className="n">GST</th><th className="n">Made</th><th /></tr></thead>
          <tbody>{exps.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.name} {!r.active && <span className="chip cancelled">{r.end_date && r.next_run_date > r.end_date ? 'Finished' : 'Stopped'}</span>}</td>
                <td>{r.category}{r.vendor ? ` - ${r.vendor}` : ''}</td>
                <td>{every(r.every_n, r.unit)}</td>
                <td>{r.active ? r.next_run_date : ''}</td>
                <td className="n">{rupees(r.amount_paise)}</td>
                <td className="n">{rupees(r.gst_paise)}</td>
                <td className="n">{r.created}{r.failed > 0 && <span className="error"> ({r.failed} failed)</span>}</td>
                <td className="n">
                  <button className="link" onClick={() => void showExpRuns(r.id)}>{openExpRuns === r.id ? 'Hide runs' : 'Runs'}</button>
                  {canWrite && (<>{' '}
                    <button className="link" disabled={busy} onClick={() => run(async () => { await api(`/api/recurring-expenses/${r.id}/active`, { body: { active: !r.active } }); await load(); })}>{r.active ? 'Stop' : 'Resume'}</button>{' '}
                    <button className="link" disabled={busy} onClick={() => { if (confirm(`Remove "${r.name}"? Expenses already recorded are kept.`)) void run(async () => { await api(`/api/recurring-expenses/${r.id}`, { method: 'DELETE' }); await load(); }); }}>Remove</button></>)}
                </td>
              </tr>
              {openExpRuns === r.id && (
                <tr><td colSpan={8}>
                  {expRuns.length === 0 ? <span className="muted">Nothing recorded yet. The first expense is recorded on {r.next_run_date}.</span> : (
                    <table className="t"><thead><tr><th>Date</th><th>Result</th><th>Expense</th></tr></thead>
                      <tbody>{expRuns.map((x) => (
                        <tr key={x.id}><td>{x.run_date}</td>
                          <td>{x.status === 'failed' ? <span className="error">Could not record it: {x.note}</span> : <>Recorded{x.note ? `. ${x.note}` : ''}</>}</td>
                          <td>{x.expense_id ? <a href="/app/expenses">In expenses</a> : ''}</td></tr>))}</tbody></table>)}
                </td></tr>)}
            </Fragment>))}</tbody>
        </table>)}
    </>
  );
}
