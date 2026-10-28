'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, paiseToRupeeText, rupees } from '../../../../lib/client';

type Ev = { at: string; kind: string; title: string; amountPaise: string; balancePaise: string | null; allocationId?: string; refundable?: boolean };
type Tl = { totalPaise: string; duePaise: string; state: 'paid' | 'part_paid' | 'unpaid'; events: Ev[] };
const STATE = { paid: 'Paid in full', part_paid: 'Part paid', unpaid: 'Not paid yet' };
const METHODS: [string, string][] = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['netbanking', 'Net banking'], ['other', 'Other']];

/** Every rupee that moved on this invoice, in order, with what was still owed after each step. Refunds can be made from here. */
export default function PaymentTimeline({ documentId, refreshKey, canRefund, onChange }: { documentId: string; refreshKey: unknown; canRefund: boolean; onChange: () => void }) {
  const [t, setT] = useState<Tl | null>(null);
  const [refund, setRefund] = useState<{ id: string; amount: string; method: string; note: string } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { setT(await api(`/api/documents/${documentId}/timeline`)); }, [documentId]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load, refreshKey]);
  if (!t) return err ? <p className="error" role="alert">{err}</p> : null;
  return (
    <div aria-label="Payment timeline" data-testid="payment-timeline" style={{ marginBottom: 14 }}>
      <p><span className={`chip ${t.state === 'paid' ? 'paid' : t.state === 'part_paid' ? 'due' : 'draft'}`}>{STATE[t.state]}</span>{' '}
        <span className="muted">{t.state === 'paid' ? 'Nothing is owed.' : `${rupees(t.duePaise)} of ${rupees(t.totalPaise)} is still owed.`}</span></p>
      <ol className="plain" style={{ listStyle: 'none', padding: 0 }}>
        {t.events.map((e, i) => (
          <li key={i} style={{ display: 'block', padding: '6px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span><b>{e.at}</b> {e.title}</span>
              <span className={BigInt(e.amountPaise) < 0n ? 'error' : ''}>{e.kind === 'issued' || e.kind === 'link' ? rupees(e.amountPaise) : BigInt(e.amountPaise) < 0n ? `- ${rupees(-BigInt(e.amountPaise))}` : `- ${rupees(e.amountPaise)}`}</span>
            </div>
            {e.balancePaise !== null && <div className="muted" style={{ fontSize: 13 }}>{BigInt(e.balancePaise) === 0n ? 'Paid in full' : `${rupees(e.balancePaise)} still owed`}</div>}
            {canRefund && e.refundable && e.allocationId && (refund?.id === e.allocationId ? (
              <form className="row" style={{ marginTop: 6 }} onSubmit={(ev) => {
                ev.preventDefault(); setErr('');
                api(`/api/payments/allocations/${e.allocationId}/refund`, { body: { amount: refund.amount, method: refund.method, note: refund.note || undefined } })
                  .then(() => { setRefund(null); onChange(); return load(); }).catch((x) => setErr(x.message));
              }}>
                <div><label htmlFor={`ra${i}`}>Refund (Rs)</label><input id={`ra${i}`} inputMode="decimal" value={refund.amount} onChange={(x) => setRefund({ ...refund, amount: x.target.value })} required /></div>
                <div><label htmlFor={`rm${i}`}>Returned by</label><select id={`rm${i}`} value={refund.method} onChange={(x) => setRefund({ ...refund, method: x.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label htmlFor={`rn${i}`}>Note</label><input id={`rn${i}`} maxLength={300} value={refund.note} onChange={(x) => setRefund({ ...refund, note: x.target.value })} /></div>
                <button style={{ flex: 'none' }}>Refund</button>
                <button type="button" className="secondary" style={{ flex: 'none' }} onClick={() => setRefund(null)}>Cancel</button>
              </form>
            ) : <button className="link" onClick={() => setRefund({ id: e.allocationId!, amount: paiseToRupeeText(e.amountPaise), method: 'bank_transfer', note: '' })}>Refund some or all of this</button>)}
          </li>))}
      </ol>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
