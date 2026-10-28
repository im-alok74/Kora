'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../../lib/client';

type Data = {
  plan: string; planName: string; status: string; validUntil: string | null; canBuy: boolean; enforced: boolean;
  usage: { invoicesThisMonth: number; members: number };
  subscription: { plan: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null;
  payments: { id: string; amount_paise: string; paid_at: string }[];
  plans: { id: string; name: string; pricePaise: number }[];
};
const LIMITS: Record<string, { invoices: number | null; members: number }> = { starter: { invoices: 10, members: 1 }, business: { invoices: null, members: 3 }, firm: { invoices: null, members: 25 } };
const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS: Record<string, string> = { free: 'Free', trialing: 'Trial', active: 'Active', past_due: 'Payment failed: please update your payment method at Razorpay', cancelled: 'Cancelled' };

/** The plan this business is on, how much of it is used, and buying, cancelling and past payments. */
export default function Billing() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api('/api/billing').then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(load, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/billing', { body });
      if (r.url) { window.location.href = r.url; return; }
      load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (!d) return <div className="muted" role="status">{err || 'Loading…'}</div>;
  const lim = LIMITS[d.plan] ?? LIMITS.starter!;
  const mockSub = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock_subscription') : null;
  const paid = d.plan !== 'starter';
  return (
    <div>
      <h1>Billing</h1>
      {err && <p className="err" role="alert">{err}</p>}
      {!d.enforced && <p className="muted" role="note">Plan limits are not switched on yet, so nothing below is being held back.</p>}

      <div className="panel" aria-label="Your plan">
        <h2>{d.planName} plan</h2>
        <p className="muted">{STATUS[d.status] ?? d.status}{d.validUntil && paid ? ` · paid to ${day(d.validUntil)}` : ''}{d.subscription?.cancel_at_period_end ? ' · will not renew' : ''}</p>
        <ul className="plain">
          <li>Invoices and quotes this month: <b>{d.usage.invoicesThisMonth}{lim.invoices ? ` of ${lim.invoices}` : ''}</b></li>
          <li>People in this business: <b>{d.usage.members} of {lim.members}</b></li>
        </ul>
        {paid && !d.subscription?.cancel_at_period_end && d.subscription && <button className="secondary" disabled={busy} onClick={() => { if (confirm('Stop renewing? You keep the plan until the end of the period you paid for.')) void act({ action: 'cancel' }); }}>Cancel at the end of the period</button>}
      </div>

      {!paid && (
        <div className="panel" aria-label="Choose a plan">
          <h2>Move up</h2>
          {!d.canBuy && <p className="muted">Plans cannot be bought online yet. Please write to us and we will set it up.</p>}
          <div className="row" style={{ justifyContent: 'flex-start', gap: 12 }}>
            {d.plans.filter((p) => p.id !== 'starter').map((p) => (
              <div key={p.id} className="stat" style={{ minWidth: 200 }}>
                <div className="label">{p.name}</div>
                <div className="value">{rupees(BigInt(p.pricePaise))}<span className="muted" style={{ fontSize: 14 }}> a month</span></div>
                <button disabled={busy || !d.canBuy} onClick={() => void act({ action: 'checkout', plan: p.id })} style={{ marginTop: 8 }}>Choose {p.name}</button>
              </div>
            ))}
          </div>
          <p className="muted">You authorise a monthly autopay at Razorpay and can cancel any time. See <a href="/pricing">what each plan includes</a>.</p>
          {mockSub && <p className="muted" role="note">Development checkout. <button className="link" onClick={() => void act({ action: 'mock.pay', subscription: mockSub })}>Pretend I paid</button></p>}
        </div>
      )}

      <div className="panel" aria-label="Payments">
        <h2>Payments</h2>
        {d.payments.length === 0 ? <p className="muted">No payments yet.</p> : (
          <table className="t"><thead><tr><th>Date</th><th className="n">Amount</th><th>Reference</th></tr></thead>
            <tbody>{d.payments.map((p) => <tr key={p.id}><td>{day(p.paid_at)}</td><td className="n">{rupees(p.amount_paise)}</td><td className="muted">{p.id}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
  );
}
