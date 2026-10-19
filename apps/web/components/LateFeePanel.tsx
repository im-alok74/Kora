'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../lib/client';

type Status = { eligible: boolean; reason: string | null; days: number; feePaise: string; outstandingPaise: string; cfg: { enabled: boolean; mode: string; value: number; graceDays: number };
  charges: { id: string; feePaise: string; debitNoteId: string; number: string | null; status: string }[] };

/** On an issued invoice: the late fee that has built up, and a way to turn it into a draft debit note. */
export default function LateFeePanel({ invoiceId, canWrite }: { invoiceId: string; canWrite: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setS(await api(`/api/documents/${invoiceId}/late-fee`)); } catch { setS(null); } }, [invoiceId]);
  useEffect(() => { void load(); }, [load]);
  if (!s || !s.cfg.enabled || (!s.eligible && s.charges.length === 0)) return null;

  return (
    <div className="panel" data-testid="late-fee">
      <h2>Late fee</h2>
      {err && <p className="error" role="alert">{err}</p>}
      {s.eligible && (
        <p>This invoice is <b>{s.days} day{s.days === 1 ? '' : 's'}</b> past its grace period. A late fee of <b data-testid="late-fee-amount">{rupees(s.feePaise)}</b> (before GST) has built up on the {rupees(s.outstandingPaise)} still owed.</p>)}
      {s.eligible && canWrite && (
        <button disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { const r = await api(`/api/documents/${invoiceId}/late-fee`, { body: {} }); window.location.href = `/app/invoices/${r.id}`; }
          catch (e) { setErr((e as Error).message); setBusy(false); }
        }}>Create late fee debit note</button>)}
      {s.charges.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Already charged</h3>
          <ul>{s.charges.map((c) => <li key={c.id}><a href={`/app/invoices/${c.debitNoteId}`}>{c.number ?? 'Draft debit note'}</a>: {rupees(c.feePaise)} before GST ({c.status === 'draft' ? 'waiting for you to issue it' : c.status})</li>)}</ul>
        </>)}
    </div>
  );
}
