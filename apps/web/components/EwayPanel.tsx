'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/client';

type Bill = { id: string; ewb_number: string | null; status: string; valid_until: string | null; vehicle_no: string | null; distance_km: number | null; error_message: string | null; generated_at: string | null; cancel_reason: string | null };
type Overview = { advice: { applies: boolean; supported: boolean; message: string }; bills: Bill[]; problems: { code: string; message: string }[] };
const MODES: [string, string][] = [['1', 'Road'], ['2', 'Rail'], ['3', 'Air'], ['4', 'Ship']];
const STATUS: Record<string, string> = { active: 'Active', extended: 'Extended', cancelled: 'Cancelled', failed: 'Not made', pending: 'Waiting' };

/** The e-way bill for goods on an issued document: whether it is needed, the journey, the bills made, and cancelling one. */
export default function EwayPanel({ documentId, canWrite }: { documentId: string; canWrite: boolean }) {
  const [o, setO] = useState<Overview | null>(null);
  const [f, setF] = useState({ mode: '1', distanceKm: '', vehicleNo: '', transporterId: '', transporterName: '', transDocNo: '', transDocDate: '' });
  const [problems, setProblems] = useState<{ code: string; message: string }[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState<{ id: string; reason: string; remark: string } | null>(null);

  const load = useCallback(async () => { setO(await api(`/api/documents/${documentId}/eway`)); }, [documentId]);
  useEffect(() => { void load().catch((e) => setErr(e.message)); }, [load]);

  const transport = () => ({ mode: f.mode, distanceKm: f.distanceKm, vehicleNo: f.vehicleNo || null, transporterId: f.transporterId || null, transporterName: f.transporterName || null, transDocNo: f.transDocNo || null, transDocDate: f.transDocDate || null });
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); setMsg(''); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setProblems(null); };

  if (!o || !o.advice.supported) return null;
  const active = o.bills.find((b) => ['active', 'extended'].includes(b.status));

  return (
    <section className="panel" aria-label="E-way bill">
      <h2>E-way bill</h2>
      <p className={o.advice.applies ? 'warn' : 'muted'} style={{ marginTop: 0 }}>{o.advice.message}</p>
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {o.bills.length > 0 && (
        <table className="t" aria-label="E-way bills made"><thead><tr><th>Number</th><th>Status</th><th>Valid until</th><th>Vehicle</th><th /></tr></thead>
          <tbody>{o.bills.map((b) => (
            <tr key={b.id}><td>{b.ewb_number ?? '-'}</td><td>{STATUS[b.status] ?? b.status}{b.error_message ? <span className="muted"> · {b.error_message}</span> : null}{b.cancel_reason ? <span className="muted"> · {b.cancel_reason}</span> : null}</td>
              <td>{b.valid_until ? new Date(b.valid_until).toLocaleString('en-IN') : ''}</td><td>{b.vehicle_no ?? ''}</td>
              <td className="n">{canWrite && ['active', 'extended'].includes(b.status) && <button className="link" onClick={() => setCancel({ id: b.id, reason: 'mistake', remark: '' })}>Cancel</button>}</td></tr>))}</tbody></table>)}
      {cancel && canWrite && (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/documents/${documentId}/eway/${cancel.id}/cancel`, { body: { reason: cancel.reason, remark: cancel.remark } }); setCancel(null); await load(); setMsg('E-way bill cancelled.'); }); }}>
          <div className="row">
            <div><label htmlFor="cr2">Why</label><select id="cr2" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })}><option value="mistake">Data entry mistake</option><option value="duplicate">Duplicate</option><option value="order_cancelled">Order cancelled</option><option value="other">Other</option></select></div>
            <div><label htmlFor="cm2">Remark</label><input id="cm2" maxLength={100} value={cancel.remark} onChange={(e) => setCancel({ ...cancel, remark: e.target.value })} required /></div>
            <button className="danger" disabled={busy}>Confirm cancellation</button>
          </div>
          <p className="muted">Possible only within 24 hours of making the bill, and before the goods move.</p>
        </form>)}
      {canWrite && !active && (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api(`/api/documents/${documentId}/eway`, { body: { transport: transport() } }); await load(); setMsg(`E-way bill ${r.ewbNumber} made.`); }); }}>
          <h3 style={{ marginTop: 14 }}>The journey</h3>
          <div className="row">
            <div><label htmlFor="ew-mode">Mode</label><select id="ew-mode" value={f.mode} onChange={set('mode')}>{MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label htmlFor="ew-km">Distance (km)</label><input id="ew-km" inputMode="numeric" value={f.distanceKm} onChange={set('distanceKm')} placeholder="From the portal's distance calculator" /></div>
          </div>
          {f.mode === '1' ? (
            <div className="row">
              <div><label htmlFor="ew-veh">Vehicle number</label><input id="ew-veh" value={f.vehicleNo} onChange={set('vehicleNo')} placeholder="MH12AB1234" /></div>
              <div><label htmlFor="ew-tid">Transporter GSTIN (if the transporter adds the vehicle)</label><input id="ew-tid" maxLength={15} value={f.transporterId} onChange={set('transporterId')} /></div>
              <div><label htmlFor="ew-tn">Transporter name</label><input id="ew-tn" value={f.transporterName} onChange={set('transporterName')} /></div>
            </div>) : (
            <div className="row">
              <div><label htmlFor="ew-doc">Transport document number</label><input id="ew-doc" value={f.transDocNo} onChange={set('transDocNo')} /></div>
              <div><label htmlFor="ew-dd">Transport document date</label><input id="ew-dd" type="date" value={f.transDocDate} onChange={set('transDocDate')} /></div>
            </div>)}
          {problems && problems.length > 0 && <ul className="error" role="alert">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
          {problems && problems.length === 0 && <p className="ok" role="status">Everything the portal checks looks right.</p>}
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <button disabled={busy} style={{ flex: 'none' }}>Make the e-way bill</button>
            <button type="button" className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => void run(async () => setProblems((await api(`/api/documents/${documentId}/eway`, { body: { transport: transport(), check: true } })).problems))}>Check</button>
            <button type="button" className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => void run(async () => {
              const j = await api(`/api/documents/${documentId}/eway/json`, { body: { transport: transport() } });
              const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }));
              const a = document.createElement('a'); a.href = url; a.download = 'eway-bill.json'; a.click(); URL.revokeObjectURL(url);
              setMsg('Downloaded. Upload it on the e-way bill portal’s bulk generation page.');
            })}>Download JSON for the portal</button>
          </div>
          <p className="muted">Kora sends the bill through your GST partner. Until a partner is connected, download the JSON and upload it on the portal yourself.</p>
        </form>)}
    </section>
  );
}
