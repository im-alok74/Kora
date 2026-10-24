import { describe, expect, it } from 'vitest';
import { compoundInterest, emi, fromCostAndPrice, num, priceFromMargin, priceFromMarkup, schedule, simpleInterest } from '../lib/calcs';

describe('margin and markup', () => {
  it('tells margin (on price) from markup (on cost)', () => {
    expect(fromCostAndPrice(80, 100)).toEqual({ cost: 80, price: 100, profit: 20, marginPct: 20, markupPct: 25 });
    expect(fromCostAndPrice(120, 100)).toMatchObject({ profit: -20, marginPct: -20, markupPct: -16.67 });   // a loss
  });
  it('finds the price for a markup or a margin', () => {
    expect(priceFromMarkup(80, 25).price).toBe(100);
    expect(priceFromMargin(80, 20).price).toBe(100);
    expect(priceFromMargin(100, 50).price).toBe(200);
    expect(() => priceFromMargin(80, 100)).toThrow();
    expect(() => fromCostAndPrice(10, 0)).toThrow();
  });
  it('reads plain numbers only', () => {
    expect(num('1,25,000.50')).toBe(125000.5);
    for (const bad of ['', 'abc', '-5', '1e3', '1.2.3']) expect(num(bad), bad).toBeNull();
  });
});

describe('EMI', () => {
  it('matches a known home loan: 10 lakh, 9% a year, 20 years', () => {
    const r = emi(1_000_000, 9, 240);
    expect(r.emi).toBeCloseTo(8997.26, 2);
    expect(r.total).toBeCloseTo(8997.26 * 240, 1);
    expect(r.interest).toBeCloseTo(r.total - 1_000_000, 2);
  });
  it('splits evenly with no interest and refuses bad input', () => {
    expect(emi(12000, 0, 12)).toEqual({ emi: 1000, total: 12000, interest: 0 });
    for (const [p, r, n] of [[0, 9, 12], [1000, -1, 12], [1000, 9, 0], [1000, 9, 6.5]] as const) expect(() => emi(p, r, n)).toThrow();
  });
  it('the schedule repays the whole loan', () => {
    const rows = schedule(500_000, 10, 24, 24);
    expect(rows).toHaveLength(24);
    expect(rows[23]!.balance).toBe(0);
    expect(rows.reduce((s, x) => s + x.principal, 0)).toBeCloseTo(500_000, 1);
    expect(rows[0]!.interest).toBeCloseTo(4166.67, 2);
  });
});

describe('interest', () => {
  it('simple interest', () => { expect(simpleInterest(100_000, 8, 3)).toEqual({ interest: 24000, total: 124000 }); });
  it('compound interest, yearly and quarterly', () => {
    expect(compoundInterest(100_000, 10, 2, 1)).toEqual({ interest: 21000, total: 121000 });
    expect(compoundInterest(100_000, 12, 1, 4).total).toBe(112550.88);
  });
  it('refuses nonsense', () => {
    expect(() => simpleInterest(0, 8, 3)).toThrow();
    expect(() => compoundInterest(1000, -1, 1, 12)).toThrow();
  });
});
