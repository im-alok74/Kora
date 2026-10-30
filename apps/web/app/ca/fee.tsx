'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/client';

type Fee = { amountPaise: string; description: string; status: 'unbilled' | 'billed' | 'paid' | 'waived'; reference: string | null; billedOn: string | null; paidOn: string | null; waivedReason: string | null };
const rupees = (p: string) => (Number(BigInt(p)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The firm's own fee for this work: what was agreed, whether it was invoiced (the invoice is made in the firm's own Kora business) and whether it was paid. */
export default function FeePanel({ engagementId, wide, onChange }: { engagementId: string; wide: boolean; onChange?: () => void }) {
  const [fee, setFee] = useState<Fee | null | undefined>(undefined);
  const [f, setF] = useState({ amount: '', description: '', reference: '', reason: '' });
  const [err, setErr] = useState('');
  const load = useCallback(async () => { setFee((await api<{ fee: Fee | null }>(`/api/ca/engagements/${engagementId}/fee`)).fee); }, [engagementId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (body: object) => { setErr(''); try { await api(`/api/ca/engagements/${engagementId}/fee`, { body }); await load(); onChange?.(); } catch (e) { setErr((e as Error).message); } };
  if (fee === undefined) return null;
  const state = !fee ? '' : fee.status === 'unbilled' ? 'Not billed yet' : fee.status === 'billed' ? `Billed ${fee.billedOn} (${fee.reference})` : fee.status === 'paid' ? `Paid ${fee.paidOn}` : 'No fee';
  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
      <h3 style={{ fontSize: 16 }}>Our fee</h3>
      {err && <p className="error" role="alert">{err}</p>}
      {fee && <p>Rs {rupees(fee.amountPaise)}{fee.description && <> · {fee.description}</>} <span className={fee.status === 'paid' ? 'chip paid' : 'chip'}>{state}</span>{fee.waivedReason && <span className="muted"> · {fee.waivedReason}</span>}</p>}
      {!fee && <p className="muted">No fee recorded yet. Finished work with no fee counts as unbilled.</p>}
      {wide && (!fee || fee.status === 'unbilled') && (
        <>
          <form className="filters" onSubmit={(e) => { e.preventDefault(); void run({ action: 'set', amount: f.amount, description: f.description }); }}>
            <div><label htmlFor={`feeamt${engagementId}`}>Fee (rupees)</label><input id={`feeamt${engagementId}`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></div>
            <div style={{ flex: 2 }}><label htmlFor={`feedesc${engagementId}`}>For</label><input id={`feedesc${engagementId}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={200} /></div>
            <button className="secondary">{fee ? 'Change the fee' : 'Set the fee'}</button>
          </form>
          {fee && fee.status === 'unbilled' && (
            <form className="filters" onSubmit={(e) => { e.preventDefault(); void run({ action: 'billed', reference: f.reference }); }}>
              <div><label htmlFor={`feeref${engagementId}`}>Invoice number</label><input id={`feeref${engagementId}`} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required maxLength={60} /></div>
              <button className="secondary">Mark as billed</button>
            </form>
          )}
          <form className="filters" onSubmit={(e) => { e.preventDefault(); void run({ action: 'waive', reason: f.reason }); }}>
            <div style={{ flex: 2 }}><label htmlFor={`feewhy${engagementId}`}>No fee for this work, because</label><input id={`feewhy${engagementId}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} /></div>
            <button className="secondary" disabled={!f.reason.trim()}>No fee</button>
          </form>
        </>
      )}
      {wide && fee?.status === 'billed' && <p><button className="btn" onClick={() => run({ action: 'paid' })}>Mark as paid</button></p>}
    </div>
  );
}
