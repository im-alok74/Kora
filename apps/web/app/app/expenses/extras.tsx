'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../../lib/client';

type Bill = { id: string; expense_date: string; vendor: string | null; category: string; amount_paise: string; bill_to_party_id: string; customer: string };
type Cust = { id: string; name: string; kind: string };
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** Mileage claims, and expenses passed on to a customer: mark them, then turn the ones for one customer into a draft invoice. */
export default function ExpenseExtras({ rows, canWrite, onChange }: { rows: { id: string; expense_date: string; vendor: string | null; category: string; amount_paise: string }[]; canWrite: boolean; onChange: () => void }) {
  const [custs, setCusts] = useState<Cust[]>([]);
  const [bill, setBill] = useState<Bill[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [m, setM] = useState({ date: today(), from: '', to: '', km: '', rate: '', party: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const loadBill = useCallback(async () => { setBill((await api('/api/expenses/billable')).expenses); }, []);
  useEffect(() => { api('/api/parties').then((r) => setCusts((r.parties as Cust[]).filter((p) => p.kind !== 'vendor'))); void loadBill().catch(() => {}); }, [loadBill, rows]);
  const run = async (fn: () => Promise<void>, done: string) => { setErr(''); setMsg(''); try { await fn(); setMsg(done); onChange(); await loadBill(); } catch (e) { setErr((e as Error).message); } };
  const billedIds = new Set(bill.map((b) => b.id));
  const byCustomer = [...new Set(bill.map((b) => b.bill_to_party_id))];
  const chosenFor = (pid: string) => picked.filter((id) => bill.find((b) => b.id === id)?.bill_to_party_id === pid);

  return (
    <>
      <form className="panel" aria-label="Mileage" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/expenses/mileage', { body: { date: m.date, from: m.from, to: m.to, km: m.km, ratePerKm: m.rate, billToPartyId: m.party || null } }); setM({ ...m, from: '', to: '', km: '' }); }, 'Mileage saved as an expense.'); }}>
        <h2>Mileage</h2>
        <p className="muted">Kilometres driven for work, at a rate per kilometre. The amount is worked out for you and saved as an expense.</p>
        <div className="row">
          <div><label htmlFor="md">Date</label><input id="md" type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} required /></div>
          <div><label htmlFor="mf">From</label><input id="mf" value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} /></div>
          <div><label htmlFor="mt">To</label><input id="mt" value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} /></div>
        </div>
        <div className="row">
          <div><label htmlFor="mk">Distance (km)</label><input id="mk" inputMode="decimal" value={m.km} onChange={(e) => setM({ ...m, km: e.target.value })} required /></div>
          <div><label htmlFor="mr">Rate per km (Rs)</label><input id="mr" inputMode="decimal" value={m.rate} onChange={(e) => setM({ ...m, rate: e.target.value })} required /></div>
          <div><label htmlFor="mp">Bill to a customer (optional)</label><select id="mp" value={m.party} onChange={(e) => setM({ ...m, party: e.target.value })}><option value="">Nobody</option>{custs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        {canWrite && <button>Save mileage</button>}
      </form>

      <div className="panel" aria-label="Billable expenses">
        <h2>Expenses to pass on to customers</h2>
        <p className="muted">Choose who each expense is billed to. Then make a draft invoice for that customer. The draft has GST at 0%: whether a re-billed cost carries GST depends on your case, so check with your CA and change the rate on the draft if needed.</p>
        {rows.length > 0 && (
          <table className="t cards" aria-label="Choose who to bill"><thead><tr><th>Date</th><th>Expense</th><th className="n">Amount</th><th>Bill to</th></tr></thead>
            <tbody>{rows.filter((r) => !billedIds.has(r.id)).slice(0, 30).map((r) => (
              <tr key={r.id}><td className="c-date">{r.expense_date}</td><td className="c-cust">{r.vendor ? `${r.vendor}, ` : ''}{r.category}</td><td className="n c-total">{rupees(r.amount_paise)}</td>
                <td><select aria-label={`Bill ${r.category} of ${r.expense_date} to`} disabled={!canWrite} value="" onChange={(e) => e.target.value && void run(async () => { await api(`/api/expenses/${r.id}/billable`, { method: 'PUT', body: { partyId: e.target.value } }); }, 'Marked billable.')}>
                  <option value="">Not billable</option>{custs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td></tr>))}</tbody></table>)}
        {byCustomer.map((pid) => {
          const list = bill.filter((b) => b.bill_to_party_id === pid);
          const sel = chosenFor(pid);
          return (
            <div key={pid} style={{ marginTop: 14 }}>
              <h3>{list[0]!.customer}</h3>
              <ul className="plain">{list.map((b) => (
                <li key={b.id}><label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
                  <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={picked.includes(b.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} />
                  {b.expense_date} {b.vendor ? `${b.vendor}, ` : ''}{b.category}</label><span>{rupees(b.amount_paise)}</span></li>))}</ul>
              {canWrite && <button disabled={sel.length === 0} onClick={() => void run(async () => { const r = await api('/api/expenses/invoice', { body: { partyId: pid, expenseIds: sel } }); setPicked(picked.filter((x) => !sel.includes(x))); window.location.href = `/app/invoices/${r.documentId}`; }, 'Draft invoice made.')}>Make a draft invoice for {sel.length || 'the chosen'} expense{sel.length === 1 ? '' : 's'}</button>}
            </div>);
        })}
        {msg && <p className="ok" role="status">{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </>
  );
}
