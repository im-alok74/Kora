/** Plain calculators for the free tools. Amounts are in rupees and results are rounded to the paisa. */
const paisa = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.round(n * 100) / 100;

/** "1,25,000.50" -> 125000.5. Returns null for anything that is not a plain non-negative number. */
export function num(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type Margin = { cost: number; price: number; profit: number; marginPct: number; markupPct: number };

/** Profit, margin and markup. Margin is profit as a share of the selling price; markup is profit as a share of the cost. */
export function fromCostAndPrice(cost: number, price: number): Margin {
  if (price <= 0) throw new RangeError('The selling price must be more than zero.');
  const profit = price - cost;
  return { cost: paisa(cost), price: paisa(price), profit: paisa(profit), marginPct: pct((profit / price) * 100), markupPct: cost > 0 ? pct((profit / cost) * 100) : 0 };
}
/** The selling price that gives a markup on cost. 80 at 25% markup -> 100. */
export function priceFromMarkup(cost: number, markupPct: number): Margin { return fromCostAndPrice(cost, cost * (1 + markupPct / 100)); }
/** The selling price that gives a margin on price. 80 at 20% margin -> 100. Margin must be under 100%. */
export function priceFromMargin(cost: number, marginPct: number): Margin {
  if (marginPct >= 100) throw new RangeError('A margin of 100% or more is not possible.');
  return fromCostAndPrice(cost, cost / (1 - marginPct / 100));
}

export type Emi = { emi: number; total: number; interest: number };
/**
 * Monthly instalment on a reducing balance loan: P r (1+r)^n / ((1+r)^n - 1), with r the monthly rate (annual rate / 12 / 100)
 * and n the number of months. With no interest the loan is simply split evenly.
 */
export function emi(principal: number, annualPct: number, months: number): Emi {
  if (!(principal > 0) || !(months >= 1) || !Number.isInteger(months) || annualPct < 0) throw new RangeError('Check the amount, the rate and the number of months.');
  const r = annualPct / 12 / 100;
  const e = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  const emiPaisa = paisa(e);
  return { emi: emiPaisa, total: paisa(emiPaisa * months), interest: paisa(emiPaisa * months - principal) };
}

/** What the first `rows` months of a loan look like: interest, principal repaid and balance left. */
export function schedule(principal: number, annualPct: number, months: number, rows = 12): { month: number; interest: number; principal: number; balance: number }[] {
  const { emi: e } = emi(principal, annualPct, months);
  const r = annualPct / 12 / 100;
  let bal = principal;
  const out = [];
  for (let m = 1; m <= Math.min(rows, months); m++) {
    const interest = paisa(bal * r);
    const paid = m === months ? bal : paisa(e - interest);
    bal = paisa(bal - paid);
    out.push({ month: m, interest, principal: paisa(paid), balance: Math.max(0, bal) });
  }
  return out;
}

export type Interest = { interest: number; total: number };
/** Simple interest: P x rate x years / 100. */
export function simpleInterest(principal: number, annualPct: number, years: number): Interest {
  if (!(principal > 0) || !(years > 0) || annualPct < 0) throw new RangeError('Check the amount, the rate and the time.');
  const i = (principal * annualPct * years) / 100;
  return { interest: paisa(i), total: paisa(principal + i) };
}
/** Compound interest: P (1 + r/n)^(n t) - P, compounded `perYear` times a year. */
export function compoundInterest(principal: number, annualPct: number, years: number, perYear: 1 | 2 | 4 | 12): Interest {
  if (!(principal > 0) || !(years > 0) || annualPct < 0) throw new RangeError('Check the amount, the rate and the time.');
  const total = principal * (1 + annualPct / 100 / perYear) ** (perYear * years);
  return { interest: paisa(total - principal), total: paisa(total) };
}
