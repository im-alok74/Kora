'use client';
import ExpenseExtras from './extras';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../../lib/client';

type Row = { id: string; expense_date: string; vendor: string | null; category: string; amount_paise: string; gst_paise: string; paid_via: string; notes: string | null; has_receipt: boolean };
type List = { from: string; to: string; rows: Row[]; total: string; gst: string; byCategory: { category: string; total: string }[] };

const CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Travel', 'Office supplies', 'Software and subscriptions', 'Professional fees', 'Marketing', 'Repairs and maintenance', 'Bank charges', 'Purchases for resale', 'Other'];
const PAID: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', cheque: 'Cheque', other: 'Other' };
const MAX_BYTES = 2 * 1024 * 1024;
const today = () => new Date().toLocaleDateString('en-CA');
const BLANK = { date: today(), vendor: '', category: 'Other', amount: '', gst: '', paidVia: 'cash', notes: '' };

const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** A phone photo is often 4 MB or more. Shrink pictures here so the receipt fits; a PDF is sent as it is. */
async function prepareReceipt(file: File): Promise<{ name: string; type: string; data: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error('That PDF is larger than 2 MB. Use a smaller file or a photo.');
    return { name: file.name, type: file.type, data: toBase64(await file.arrayBuffer()) };
  }
  if (!file.type.startsWith('image/')) throw new Error('A receipt can be a photo (JPEG or PNG) or a PDF.');
  if (file.size <= 1_500_000 && (file.type === 'image/jpeg' || file.type === 'image/png')) return { name: file.name, type: file.type, data: toBase64(await file.arrayBuffer()) };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  if (!blob || blob.size > MAX_BYTES) throw new Error('The photo is too large to keep. Try a smaller one.');
  return { name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', data: toBase64(await blob.arrayBuffer()) };
}

export default function Expenses() {
  const [from, setFrom] = useState(() => today().slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<List | null>(null);
  const [role, setRole] = useState('');
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const canWrite = role === 'owner' || role === 'staff';
  const canExport = role === 'owner' || role === 'accountant';

  const query = `from=${from}&to=${to}${category ? `&category=${encodeURIComponent(category)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const load = useCallback(async () => { setList(await api(`/api/expenses?${query}`)); }, [query]);
  useEffect(() => { const h = setTimeout(() => { void load().catch((e) => setErr(e.message)); }, 150); return () => clearTimeout(h); }, [load]);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)); }, []);

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const body = { date: form.date, vendor: form.vendor || null, category: form.category, amount: form.amount, gst: form.gst || null, paidVia: form.paidVia, notes: form.notes || null };
      const prepared = file ? await prepareReceipt(file) : null;
      const r = await api(editing ? `/api/expenses/${editing}` : '/api/expenses', { method: editing ? 'PUT' : 'POST', body });
      if (prepared) await api(`/api/expenses/${r.id}/receipt`, { method: 'PUT', body: prepared });
      setForm(BLANK); setFile(null); setEditing(null); setOpen(false); await load(); setMsg('Expense saved.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const categories = [...new Set([...CATEGORIES, ...(list?.byCategory.map((c) => c.category) ?? [])])];

  return (
    <>
      <div className="toolbar">
        <h1>Expenses</h1>
        <div className="row" style={{ flex: 'none' }}>
          {canExport && <a className="btn secondary" href={`/api/expenses?${query}&format=csv`}>Download CSV</a>}
          {canWrite && !open && <button onClick={() => { setOpen(true); setEditing(null); setForm(BLANK); }}>Add an expense</button>}
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      {open && canWrite && (
        <form className="panel" aria-label="Expense" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h2>{editing ? 'Edit expense' : 'Add an expense'}</h2>
          <div className="row">
            <div><label htmlFor="xd">Date</label><input id="xd" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></div>
            <div><label htmlFor="xv">Vendor</label><input id="xv" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></div>
            <div><label htmlFor="xc">Category</label><input id="xc" list="xcats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
              <datalist id="xcats">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
          </div>
          <div className="row">
            <div><label htmlFor="xa">Amount paid (Rs, with GST)</label><input id="xa" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
            <div><label htmlFor="xg">GST in that amount (Rs)</label><input id="xg" inputMode="decimal" placeholder="0" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} /></div>
            <div><label htmlFor="xp">Paid by</label>
              <select id="xp" value={form.paidVia} onChange={(e) => setForm({ ...form, paidVia: e.target.value })}>{Object.entries(PAID).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <label htmlFor="xn">Notes</label><textarea id="xn" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <label htmlFor="xf">Receipt (photo or PDF, optional)</label>
          <input id="xf" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="muted">The GST here is only for your records. Kora does not claim input tax credit.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button disabled={busy}>Save expense</button>
            <button type="button" className="secondary" onClick={() => { setOpen(false); setEditing(null); setFile(null); setErr(''); }}>Cancel</button>
          </div>
        </form>)}

      <div className="row" style={{ marginBottom: 16 }}>
        <div><label htmlFor="ef">From</label><input id="ef" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor="et">To</label><input id="et" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label htmlFor="ec">Category</label>
          <select id="ec" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label htmlFor="eq">Search</label><input id="eq" placeholder="Vendor or notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {list && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <div className="panel" style={{ margin: 0 }}><div className="muted">Spent</div><div className="portal-big" data-testid="expense-total">{rupees(list.total)}</div><div className="muted">{list.rows.length} expense{list.rows.length === 1 ? '' : 's'}</div></div>
            <div className="panel" style={{ margin: 0 }}><div className="muted">GST included</div><div className="portal-big" data-testid="expense-gst">{rupees(list.gst)}</div></div>
            <div className="panel" style={{ margin: 0 }}><div className="muted">By category</div>
              {list.byCategory.length === 0 ? <div className="muted">Nothing yet</div> : list.byCategory.slice(0, 5).map((c) => <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{c.category}</span><span>{rupees(c.total)}</span></div>)}</div>
          </div>
          {list.rows.length === 0 ? <div className="panel"><p>No expenses in this period.</p></div> : (
            <table className="t">
              <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Paid by</th><th className="n">Amount</th><th className="n">GST</th><th /></tr></thead>
              <tbody>{list.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.expense_date}</td><td>{r.vendor ?? ''}{r.notes && <div className="muted">{r.notes}</div>}</td><td>{r.category}</td><td>{PAID[r.paid_via] ?? r.paid_via}</td>
                  <td className="n">{rupees(r.amount_paise)}</td><td className="n">{BigInt(r.gst_paise) > 0n ? rupees(r.gst_paise) : ''}</td>
                  <td className="n">
                    {r.has_receipt && <a href={`/api/expenses/${r.id}/receipt`} target="_blank" rel="noreferrer">Receipt</a>}
                    {canWrite && (<>{' '}
                      <button className="link" onClick={() => { setEditing(r.id); setOpen(true); setFile(null); setForm({ date: r.expense_date, vendor: r.vendor ?? '', category: r.category, amount: (Number(r.amount_paise) / 100).toFixed(2), gst: BigInt(r.gst_paise) > 0n ? (Number(r.gst_paise) / 100).toFixed(2) : '', paidVia: r.paid_via, notes: r.notes ?? '' }); window.scrollTo({ top: 0 }); }}>Edit</button>{' '}
                      <button className="link" onClick={() => { if (confirm('Delete this expense?')) void api(`/api/expenses/${r.id}`, { method: 'DELETE' }).then(load).catch((e) => setErr(e.message)); }}>Delete</button></>)}
                  </td>
                </tr>))}</tbody>
            </table>)}
        </>)}
      {list && <ExpenseExtras rows={list.rows} canWrite={canWrite} onChange={() => { void load(); }} />}
    </>
  );
}
