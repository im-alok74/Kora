'use client';
import { useMemo, useState } from 'react';
import { formatRupees } from '@kora/tax';
import { compoundInterest, emi, fromCostAndPrice, num, priceFromMargin, priceFromMarkup, schedule, simpleInterest } from '../../lib/calcs';
import { CopyButton } from './ToolBits';

const money = (n: number) => formatRupees(BigInt(Math.round(n * 100)));
const pctText = (n: number) => `${n}%`;

/** A labelled rupee field, the same look as the GST calculator. */
function Rupees({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="tl-money"><span aria-hidden="true">Rs</span><input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" aria-describedby={hint ? `${id}-h` : undefined} /></div>
      {hint && <p id={`${id}-h`} className="muted">{hint}</p>}
    </>
  );
}
function Plain({ id, label, value, onChange, hint, mode = 'decimal' }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; mode?: 'decimal' | 'numeric' }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode={mode} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <p id={`${id}-h`} className="muted">{hint}</p>}
    </>
  );
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => <div className={strong ? 'grand' : ''}><dt>{k}</dt><dd>{v}</dd></div>;

type Find = 'profit' | 'markup' | 'margin';
export function ProfitMargin() {
  const [find, setFind] = useState<Find>('profit');
  const [cost, setCost] = useState(''), [price, setPrice] = useState(''), [pctIn, setPctIn] = useState('');
  const out = useMemo(() => {
    const c = num(cost);
    if (c === null) return cost.trim() ? 'Enter the cost as a number, like 800 or 1,250.50.' : null;
    try {
      if (find === 'profit') { const p = num(price); return p === null ? (price.trim() ? 'Enter the selling price as a number.' : null) : fromCostAndPrice(c, p); }
      const x = num(pctIn);
      if (x === null) return pctIn.trim() ? 'Enter the percentage as a number, like 25.' : null;
      return find === 'markup' ? priceFromMarkup(c, x) : priceFromMargin(c, x);
    } catch (e) { return (e as Error).message; }
  }, [find, cost, price, pctIn]);
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="tl-fs"><legend>I want to find</legend>
          <div className="tl-stack">
            <label className="tl-check"><input type="radio" name="pm" checked={find === 'profit'} onChange={() => setFind('profit')} /> Profit, margin and markup (I know cost and price)</label>
            <label className="tl-check"><input type="radio" name="pm" checked={find === 'markup'} onChange={() => setFind('markup')} /> The price for a markup on cost</label>
            <label className="tl-check"><input type="radio" name="pm" checked={find === 'margin'} onChange={() => setFind('margin')} /> The price for a margin on the price</label>
          </div>
        </fieldset>
        <Rupees id="pm-c" label="Cost price (Rs)" value={cost} onChange={setCost} />
        {find === 'profit' ? <Rupees id="pm-p" label="Selling price (Rs)" value={price} onChange={setPrice} /> : <Plain id="pm-x" label={find === 'markup' ? 'Markup on cost (%)' : 'Margin on price (%)'} value={pctIn} onChange={setPctIn} />}
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {out === null ? <p className="muted">Enter the cost to start.</p> : typeof out === 'string' ? <p className="error">{out}</p> : (
          <>
            <p className="tl-big">{pctText(out.marginPct)}<small>margin, which is profit as a share of the selling price</small></p>
            <dl className="doc-totals">
              <Row k="Cost price" v={money(out.cost)} />
              <Row k="Selling price" v={money(out.price)} />
              <Row k={out.profit < 0 ? 'Loss' : 'Profit'} v={money(Math.abs(out.profit))} />
              <Row k="Markup (profit on cost)" v={pctText(out.markupPct)} />
              <Row k="Margin (profit on price)" v={pctText(out.marginPct)} strong />
            </dl>
          </>
        )}
        <p className="muted">Margin and markup are different: a 25% markup is a 20% margin. These figures are before GST. Add GST on top of the selling price with the GST calculator.</p>
      </div>
    </div>
  );
}

export function EmiCalculator() {
  const [amount, setAmount] = useState(''), [rate, setRate] = useState(''), [time, setTime] = useState(''), [unit, setUnit] = useState<'years' | 'months'>('years');
  const out = useMemo(() => {
    const p = num(amount), r = num(rate), t = num(time);
    if (!amount.trim() || !rate.trim() || !time.trim()) return null;
    if (p === null || r === null || t === null) return 'Enter the amount, the rate and the time as plain numbers.';
    const months = Math.round(unit === 'years' ? t * 12 : t);
    if (months > 600) return 'The loan can be up to 50 years (600 months).';
    try { return { ...emi(p, r, months), months, rows: schedule(p, r, months, Math.min(months, 12)), principal: p }; } catch (e) { return (e as Error).message; }
  }, [amount, rate, time, unit]);
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <Rupees id="em-a" label="Loan amount (Rs)" value={amount} onChange={setAmount} />
        <Plain id="em-r" label="Interest rate (% a year)" value={rate} onChange={setRate} hint="On a reducing balance, as most bank loans are." />
        <div className="tl-row">
          <div><Plain id="em-t" label="Time" value={time} onChange={setTime} mode="numeric" /></div>
          <div><label htmlFor="em-u">In</label><select id="em-u" value={unit} onChange={(e) => setUnit(e.target.value as 'years' | 'months')}><option value="years">Years</option><option value="months">Months</option></select></div>
        </div>
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {out === null ? <p className="muted">Enter the loan amount, the rate and the time.</p> : typeof out === 'string' ? <p className="error">{out}</p> : (
          <>
            <p className="tl-big">{money(out.emi)}<small>a month for {out.months} month{out.months === 1 ? '' : 's'}</small></p>
            <dl className="doc-totals">
              <Row k="Loan amount" v={money(out.principal)} />
              <Row k="Total interest" v={money(out.interest)} />
              <Row k="Total paid back" v={money(out.total)} strong />
            </dl>
            <h3 className="tl-sub">First {out.rows.length} month{out.rows.length === 1 ? '' : 's'}</h3>
            <div className="tl-tablewrap">
              <table className="tl-table">
                <thead><tr><th scope="col">Month</th><th scope="col" className="num">Interest</th><th scope="col" className="num">Principal</th><th scope="col" className="num">Balance</th></tr></thead>
                <tbody>{out.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{money(r.interest)}</td><td className="num">{money(r.principal)}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <p className="muted">EMI = P x r x (1 + r)^n / ((1 + r)^n - 1), with r the monthly rate and n the months. A bank may add fees or round differently, so treat it as a close guide.</p>
      </div>
    </div>
  );
}

export function InterestCalculator() {
  const [kind, setKind] = useState<'simple' | 'compound'>('simple');
  const [amount, setAmount] = useState(''), [rate, setRate] = useState(''), [years, setYears] = useState(''), [per, setPer] = useState<1 | 2 | 4 | 12>(1);
  const out = useMemo(() => {
    if (!amount.trim() || !rate.trim() || !years.trim()) return null;
    const p = num(amount), r = num(rate), t = num(years);
    if (p === null || r === null || t === null) return 'Enter the amount, the rate and the time as plain numbers.';
    try { return kind === 'simple' ? simpleInterest(p, r, t) : compoundInterest(p, r, t, per); } catch (e) { return (e as Error).message; }
  }, [kind, amount, rate, years, per]);
  const text = typeof out === 'object' && out ? `Interest ${money(out.interest)}, total ${money(out.total)}` : '';
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="tl-fs"><legend>Type of interest</legend>
          <div className="tl-seg">
            <label className="tl-check"><input type="radio" name="ik" checked={kind === 'simple'} onChange={() => setKind('simple')} /> Simple</label>
            <label className="tl-check"><input type="radio" name="ik" checked={kind === 'compound'} onChange={() => setKind('compound')} /> Compound</label>
          </div>
        </fieldset>
        <Rupees id="ic-a" label="Amount (Rs)" value={amount} onChange={setAmount} />
        <Plain id="ic-r" label="Interest rate (% a year)" value={rate} onChange={setRate} />
        <Plain id="ic-t" label="Time (years)" value={years} onChange={setYears} hint="Use decimals for part of a year, for example 1.5." />
        {kind === 'compound' && (
          <>
            <label htmlFor="ic-n">Compounded</label>
            <select id="ic-n" value={per} onChange={(e) => setPer(Number(e.target.value) as 1 | 2 | 4 | 12)}><option value={1}>Yearly</option><option value={2}>Half-yearly</option><option value={4}>Quarterly</option><option value={12}>Monthly</option></select>
          </>
        )}
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {out === null ? <p className="muted">Enter the amount, the rate and the time.</p> : typeof out === 'string' ? <p className="error">{out}</p> : (
          <>
            <p className="tl-big">{money(out.interest)}<small>interest earned or owed</small></p>
            <dl className="doc-totals">
              <Row k="Amount" v={money(num(amount)!)} />
              <Row k="Interest" v={money(out.interest)} />
              <Row k="Total" v={money(out.total)} strong />
            </dl>
            <div className="tl-actions"><CopyButton text={text} what="the result" /></div>
          </>
        )}
        <p className="muted">{kind === 'simple' ? 'Simple interest = amount x rate x years / 100.' : 'Compound interest = amount x (1 + rate / (100 x n)) ^ (n x years) - amount, with n the times compounded in a year.'}</p>
      </div>
    </div>
  );
}
