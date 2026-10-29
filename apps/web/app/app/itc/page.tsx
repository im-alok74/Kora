'use client';
import KoraLoader from '../../../components/KoraLoader';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import { api, rupees } from '../../../lib/client';

type Heads = { taxable: string; igst: string; cgst: string; sgst: string; cess: string };
type Summary = { period: string; has2b: boolean; billCount: number; ordinary: Heads; reverseCharge: Heads; blocked: Heads; claimable: Heads; eligibleTotal: string; blockedTotal: string; atRiskTotal: string;
  atRiskBills: { id: string; billNumber: string; vendor: string; billDate: string; taxPaise: string }[]; blockedBills: { id: string; billNumber: string; vendor: string; reason: string | null }[] };
type Entry = { entryId: string; gstin: string; supplier: string | null; invoiceNumber: string; invoiceDate: string | null; itcAvailable: boolean; taxablePaise?: string; taxPaise?: string; billId?: string; billNumber?: string; differences?: Record<string, string> };
type Recon = { loaded: number; counts: { matched: number; mismatched: number; onlyIn2b: number; onlyInBooks: number }; mismatched: Entry[]; onlyIn2b: Entry[]; onlyInBooks: { billId: string; billNumber: string; billDate: string; vendor: string; gstin: string; taxPaise: string }[] };
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const sum = (h: Heads) => BigInt(h.igst) + BigInt(h.cgst) + BigInt(h.sgst) + BigInt(h.cess);

/** The credit on purchase bills for a month, and a check of those bills against what suppliers have filed (GSTR-2B). */
export default function Itc() {
  const [period, setPeriod] = useState(thisMonth());
  const [s, setS] = useState<Summary | null>(null);
  const [r, setR] = useState<Recon | null>(null);
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setS(await api(`/api/itc?period=${period}`));
    const rec = await api('/api/itc/reconcile', { body: { period } });
    setR(rec.loaded > 0 ? rec : null);
  }, [period]);
  useEffect(() => { setErr(''); load().catch((e) => setErr(e.message)); api('/api/business').then((b) => setRole(b.role)); }, [load]);
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const canWrite = role === 'owner' || role === 'staff' || role === 'accountant';

  const upload = (file: File) => run(async () => {
    let json: unknown;
    try { json = JSON.parse(await file.text()); } catch { throw new Error('That file is not JSON. Download the GSTR-2B JSON from the GST portal.'); }
    const res = await api('/api/itc/gstr2b', { body: { period, json } });
    setMsg(`Loaded ${res.entries} supplier invoices. ${res.matched} match your bills.`);
    await load();
  });

  return (
    <>
      <div className="toolbar">
        <div><h1>Input credit</h1><p className="page-sub">The GST you paid on purchases, and whether your suppliers have filed it, so you only claim what is safe.</p></div>
        <a className="btn secondary" href="/app/purchases">Purchases</a>
      </div>
      <div className="filters"><div style={{ maxWidth: 220 }}><label htmlFor="ip">Month</label><input id="ip" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {!s && !err && <KoraLoader />}

      {s && (<>
        <div className="stats">
          <div className="stat"><div className="label">Credit you can claim</div><div className="value" data-testid="itc-eligible">{rupees(s.eligibleTotal)}</div></div>
          <div className="stat"><div className="label">At risk: not filed by supplier</div><div className="value" data-testid="itc-risk">{s.has2b ? rupees(s.atRiskTotal) : 'Load 2B'}</div></div>
          <div className="stat"><div className="label">Blocked</div><div className="value">{rupees(s.blockedTotal)}</div></div>
          <div className="stat"><div className="label">Bills this month</div><div className="value">{s.billCount}</div></div>
        </div>

        <div className="panel">
          <p className="section-label">Credit by tax</p>
          <table className="t" aria-label="Credit by tax">
            <thead><tr><th /><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th><th className="n">Total</th></tr></thead>
            <tbody>{([['On bills with tax charged', s.ordinary], ['On bills where you pay the tax (reverse charge)', s.reverseCharge], ['Blocked, not claimed', s.blocked]] as [string, Heads][]).map(([label, h]) => (
              <tr key={label}><td>{label}</td><td className="n">{rupees(h.igst)}</td><td className="n">{rupees(h.cgst)}</td><td className="n">{rupees(h.sgst)}</td><td className="n">{rupees(h.cess)}</td><td className="n"><b>{rupees(sum(h))}</b></td></tr>))}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 13 }}>The 3B summary on the Reports page uses these figures. Your CA should confirm them before filing.</p>
        </div>

        <div className="panel" aria-label="GSTR-2B">
          <p className="section-label">Check against GSTR-2B</p>
          <p className="muted">On the GST portal open Returns, GSTR-2B for {period}, and download the JSON file. Load it here to see which bills your suppliers have filed.</p>
          {canWrite && <input type="file" accept="application/json,.json" aria-label="GSTR-2B JSON file" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />}
        </div>

        {r && (<>
          <div className="stats">
            <div className="stat"><div className="label">Matched</div><div className="value" data-testid="rc-matched">{r.counts.matched}</div></div>
            <div className="stat"><div className="label">Amounts differ</div><div className="value" data-testid="rc-mismatched">{r.counts.mismatched}</div></div>
            <div className="stat"><div className="label">Only in 2B</div><div className="value" data-testid="rc-only2b">{r.counts.onlyIn2b}</div></div>
            <div className="stat"><div className="label">Only in your books</div><div className="value" data-testid="rc-onlybooks">{r.counts.onlyInBooks}</div></div>
          </div>

          {r.mismatched.length > 0 && (
            <div className="panel"><p className="section-label">Amounts that differ</p>
              <table className="t" aria-label="Differences"><thead><tr><th>Supplier</th><th>Invoice</th><th>Difference (2B minus your bill)</th></tr></thead>
                <tbody>{r.mismatched.map((m) => (<tr key={m.entryId}><td>{m.supplier ?? m.gstin}</td><td><a href={`/app/purchases/${m.billId}`}>{m.invoiceNumber}</a></td><td>{Object.entries(m.differences ?? {}).map(([k, v]) => `${k} ${BigInt(v) > 0n ? '+' : '-'}${rupees(BigInt(v) < 0n ? -BigInt(v) : BigInt(v))}`).join(', ')}</td></tr>))}</tbody></table></div>)}

          {r.onlyIn2b.length > 0 && (
            <div className="panel"><p className="section-label">Filed by suppliers, missing from your books</p>
              <p className="muted" style={{ fontSize: 13 }}>Adding a bill only records it in Kora. It does not accept or reject anything on the GST portal.</p>
              <table className="t" aria-label="In 2B only"><thead><tr><th>Supplier</th><th>Invoice</th><th className="n">Taxable</th><th className="n">Tax</th><th /></tr></thead>
                <tbody>{r.onlyIn2b.map((m) => (<tr key={m.entryId}><td>{m.supplier ?? m.gstin}</td><td>{m.invoiceNumber}{!m.itcAvailable && <> <span className="chip cancelled">ITC not available</span></>}</td><td className="n">{rupees(m.taxablePaise)}</td><td className="n">{rupees(m.taxPaise)}</td>
                  <td className="n">{canWrite && <button className="secondary sm" disabled={busy} onClick={() => run(async () => { const a = await api('/api/itc/gstr2b/accept', { body: { entryId: m.entryId } }); window.location.href = `/app/purchases/${a.billId}`; })}>Add as a bill</button>}</td></tr>))}</tbody></table></div>)}

          {r.onlyInBooks.length > 0 && (
            <div className="panel"><p className="section-label">In your books, not filed by the supplier</p>
              <p className="muted" style={{ fontSize: 13 }}>Ask these suppliers to file, or hold back the credit until they do.</p>
              <table className="t" aria-label="In books only"><thead><tr><th>Vendor</th><th>Bill</th><th>Date</th><th className="n">Credit at risk</th></tr></thead>
                <tbody>{r.onlyInBooks.map((b) => (<tr key={b.billId}><td>{b.vendor}</td><td><a href={`/app/purchases/${b.billId}`}>{b.billNumber}</a></td><td>{b.billDate}</td><td className="n">{rupees(b.taxPaise)}</td></tr>))}</tbody></table></div>)}
        </>)}
        {!r && s.has2b === false && <div className="panel empty"><Icon name="chart" size={34} style={{ color: 'var(--text-faint)' }} /><h3>No GSTR-2B loaded for {period}.</h3><p>Load the file above to see which bills your suppliers have filed.</p></div>}
      </>)}
    </>
  );
}
