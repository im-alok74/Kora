'use client';
import { useMemo, useState } from 'react';
import { formatRupees } from '@kora/tax';
import { calcGst } from '../../lib/gstCalc';

const RATES = [0, 5, 18, 40];
const OTHER: [number, string][] = [[0.25, '0.25% (rough diamonds)'], [3, '3% (gold and silver)'], [12, '12% (supplies before 22 Sep 2025)'], [28, '28% (supplies before 22 Sep 2025)']];

export default function GstCalculator() {
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState(18);
  const [mode, setMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [supply, setSupply] = useState<'intra' | 'inter'>('intra');
  const out = useMemo(() => {
    if (!amount.trim()) return null;
    try { return calcGst(amount, Math.round(rate * 100), mode, supply); } catch { return 'bad' as const; }
  }, [amount, rate, mode, supply]);
  const row = (k: string, v: bigint, strong = false) => <div className={strong ? 'grand' : ''}><dt>{k}</dt><dd>{formatRupees(v)}</dd></div>;
  const taxShare = out && out !== 'bad' && out.total > 0n ? Number((out.tax * 1000n) / out.total) / 10 : 0;

  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="tl-fs"><legend>The amount is</legend>
          <div className="tl-seg">
            <label className="tl-check"><input type="radio" name="mode" checked={mode === 'exclusive'} onChange={() => setMode('exclusive')} /> Before GST (add GST)</label>
            <label className="tl-check"><input type="radio" name="mode" checked={mode === 'inclusive'} onChange={() => setMode('inclusive')} /> With GST included (take GST out)</label>
          </div>
        </fieldset>
        <label htmlFor="ga">Amount (Rs)</label>
        <div className="tl-money"><span aria-hidden="true">Rs</span><input id="ga" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></div>
        <fieldset className="tl-fs"><legend>GST rate</legend>
          <div className="tl-chips" role="radiogroup" aria-label="GST rate">
            {RATES.map((r) => <button key={r} type="button" role="radio" aria-checked={rate === r} className={rate === r ? '' : 'secondary'} onClick={() => setRate(r)}>{r}%</button>)}
          </div>
          <label htmlFor="go">Other rates</label>
          <select id="go" value={OTHER.some(([r]) => r === rate) ? rate : ''} onChange={(e) => { if (e.target.value !== '') setRate(Number(e.target.value)); }}>
            <option value="">Choose a special or older rate</option>
            {OTHER.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </fieldset>
        <fieldset className="tl-fs"><legend>Sale</legend>
          <div className="tl-seg">
            <label className="tl-check"><input type="radio" name="supply" checked={supply === 'intra'} onChange={() => setSupply('intra')} /> Inside one state (CGST and SGST)</label>
            <label className="tl-check"><input type="radio" name="supply" checked={supply === 'inter'} onChange={() => setSupply('inter')} /> To another state (IGST)</label>
          </div>
        </fieldset>
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {out === null ? <p className="muted">Enter an amount to see the GST.</p> : out === 'bad' ? <p className="error">Enter the amount as a number, like 1250 or 1250.50.</p> : (
          <>
            <p className="tl-big">{formatRupees(out.total)}<small>total, GST included</small></p>
            <div className="tl-bar" aria-hidden="true"><span style={{ width: `${100 - taxShare}%` }} /><span className="tax" style={{ width: `${taxShare}%` }} /></div>
            <div className="tl-key" aria-hidden="true"><span><i /> Amount</span><span><i className="tax" /> GST</span></div>
            <dl className="doc-totals">
              {row('Amount before GST', out.base)}
              {out.cgst > 0n && row(`CGST (${rate / 2}%)`, out.cgst)}
              {out.sgst > 0n && row(`SGST (${rate / 2}%)`, out.sgst)}
              {out.igst > 0n && row(`IGST (${rate}%)`, out.igst)}
              {row('Total GST', out.tax)}
              {row('Amount with GST', out.total, true)}
            </dl>
          </>
        )}
        <p className="muted">Worked out in whole paise with the same rules as a Kora invoice. A plain guide, not tax advice.</p>
      </div>
    </div>
  );
}
