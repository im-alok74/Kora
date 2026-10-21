'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/client';

type Cfg = { enabled: boolean; channel: 'whatsapp' | 'sms' | 'email'; offsets: number[] };
type Preview = { channel: string; enabled: boolean; text: string | null; to: string | null; documentNumber: string | null; schedule: { offset: number; label: string; at: string | null }[] };
type Data = {
  business: Cfg; override: Cfg | null; effective: Cfg; usingBusinessDefault: boolean;
  upcoming: { id: string; channel: string; scheduled_at: string; number: string; due_date: string | null }[];
  history: { id: string; channel: string; scheduled_at: string; delivery_status: string; error_message: string | null; number: string }[];
  preview: Preview;
};
const CHANNELS: [Cfg['channel'], string][] = [['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['email', 'Email']];
const STATUS: Record<string, string> = { queued: 'Waiting to go', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Could not be sent' };
const nums = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).map(Number);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** How and when this customer is reminded about unpaid invoices. Reminders stop by themselves once the invoice is paid. */
export default function RemindersPanel({ partyId, canWrite }: { partyId: string; canWrite: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [custom, setCustom] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [channel, setChannel] = useState<Cfg['channel']>('whatsapp');
  const [before, setBefore] = useState('');
  const [onDue, setOnDue] = useState(false);
  const [after, setAfter] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const fill = (c: Cfg, usingDefault: boolean) => {
    setCustom(!usingDefault); setEnabled(c.enabled); setChannel(c.channel);
    setBefore(c.offsets.filter((o) => o < 0).map((o) => -o).join(', ')); setOnDue(c.offsets.includes(0)); setAfter(c.offsets.filter((o) => o > 0).join(', '));
  };
  const load = useCallback(async () => {
    const r: Data = await api(`/api/parties/${partyId}/reminders`);
    setD(r); setPreview(r.preview); fill(r.effective, r.usingBusinessDefault);
  }, [partyId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const config = (): Cfg => ({ enabled, channel, offsets: [...nums(before).map((n) => -n), ...(onDue ? [0] : []), ...nums(after)] });
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); try { await fn(); } catch (e) { setErr((e as Error).message); } };

  if (!d) return <p className={err ? 'error' : 'muted'} role={err ? 'alert' : 'status'}>{err || 'Loading'}</p>;
  return (
    <>
      <div className="panel" aria-label="Reminder schedule">
        <h2>Payment reminders</h2>
        <p className="muted">Kora reminds this customer about unpaid invoices on the days below, and stops by itself once an invoice is paid. Messages go through the messaging service set up for your business.</p>
        {canWrite && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={custom} onChange={(e) => { setCustom(e.target.checked); if (!e.target.checked) fill(d.business, true); }} />
            Use a schedule just for this customer
          </label>)}
        {!custom && <p>Following your business schedule: {d.business.enabled ? `${d.business.offsets.length} reminders by ${d.business.channel}` : 'reminders are off'}. Change it under Settings.</p>}
        {custom && (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api(`/api/parties/${partyId}/reminders`, { method: 'PUT', body: config() }); void r; await load(); setMsg('Schedule saved for this customer.'); }); }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Send reminders to this customer</label>
            <div className="row">
              <div><label htmlFor="rc">Send by</label><select id="rc" value={channel} onChange={(e) => setChannel(e.target.value as Cfg['channel'])}>{CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label htmlFor="rb">Days before the due date</label><input id="rb" placeholder="2, 5" value={before} onChange={(e) => setBefore(e.target.value)} /></div>
              <div><label htmlFor="ra">Days after the due date</label><input id="ra" placeholder="3, 7, 15" value={after} onChange={(e) => setAfter(e.target.value)} /></div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={onDue} onChange={(e) => setOnDue(e.target.checked)} />Also remind on the due date</label>
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <button style={{ flex: 'none' }}>Save schedule</button>
              <button type="button" className="secondary" style={{ flex: 'none' }} onClick={() => void run(async () => { setPreview(await api(`/api/parties/${partyId}/reminders`, { body: config() })); })}>Preview this schedule</button>
              <button type="button" className="link" style={{ flex: 'none' }} onClick={() => void run(async () => { await api(`/api/parties/${partyId}/reminders`, { method: 'PUT', body: null }); await load(); setMsg('This customer now follows your business schedule.'); })}>Go back to the business schedule</button>
            </div>
          </form>)}
        {msg && <p className="ok" role="status">{msg}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>

      <div className="panel" aria-label="Message preview" data-testid="reminder-preview">
        <h2>What the customer will read</h2>
        {preview?.text ? (<>
          <p className="muted">By {preview.channel}{preview.to ? ` to ${preview.to}` : ', but there is no contact for this channel yet'}. Based on invoice {preview.documentNumber}. The real link is made when the message goes out.</p>
          <blockquote style={{ margin: '8px 0', padding: '10px 14px', borderLeft: '3px solid var(--border)', whiteSpace: 'pre-wrap' }}>{preview.text}</blockquote>
          <ul className="plain">{preview.schedule.map((s) => <li key={s.offset}><span>{s.label}</span><span className="muted">{s.at ? when(s.at) : ''}</span></li>)}</ul>
        </>) : <p className="muted">There is no unpaid invoice for this customer, so there is nothing to preview yet.</p>}
      </div>

      <div className="panel" aria-label="Coming up">
        <h2>Coming up</h2>
        {d.upcoming.length === 0 ? <p className="muted">No reminders are waiting.</p> : (
          <table className="t cards" aria-label="Reminders waiting"><thead><tr><th>When</th><th>Invoice</th><th>By</th></tr></thead>
            <tbody>{d.upcoming.map((u) => <tr key={u.id}><td className="c-date">{when(u.scheduled_at)}</td><td className="c-num">{u.number}</td><td>{u.channel}</td></tr>)}</tbody></table>)}
      </div>

      <div className="panel" aria-label="Reminders sent">
        <h2>Sent so far</h2>
        {d.history.length === 0 ? <p className="muted">No reminders have gone out to this customer yet.</p> : (
          <table className="t cards" aria-label="Reminder history"><thead><tr><th>When</th><th>Invoice</th><th>By</th><th>Result</th></tr></thead>
            <tbody>{d.history.map((h) => <tr key={h.id}><td className="c-date">{when(h.scheduled_at)}</td><td className="c-num">{h.number}</td><td>{h.channel}</td>
              <td>{STATUS[h.delivery_status] ?? h.delivery_status}{h.error_message ? `: ${h.error_message}` : ''}</td></tr>)}</tbody></table>)}
      </div>
    </>
  );
}
