import { describe, expect, it } from 'vitest';
import { effectiveDiscounts, percentBp, shippingRateBp } from '../lib/discounts';

const L = (quantity: string, rate: string, discount = '') => ({ quantity, rate, discount });

describe('discounts in the editor', () => {
  it('reads percentages and refuses anything else', () => {
    expect(percentBp('10%')).toBe(1000);
    expect(percentBp(' 12.5 % ')).toBe(1250);
    expect(percentBp('100%')).toBe(10000);
    expect(percentBp('101%')).toBeNull();
    expect(percentBp('50')).toBeNull();
    expect(percentBp('abc%')).toBeNull();
  });
  it('turns a percentage on a line into rupees', () => {
    expect(effectiveDiscounts([L('2', '500', '10%')], '')).toEqual(['100.00']);
    expect(effectiveDiscounts([L('1', '99.99', '5%')], '')).toEqual(['5.00']);
  });
  it('spreads a bill discount over the lines to the paisa', () => {
    expect(effectiveDiscounts([L('1', '100'), L('1', '300')], '40')).toEqual(['10.00', '30.00']);
    const d = effectiveDiscounts([L('1', '100'), L('1', '100'), L('1', '100')], '1');
    expect(d).toEqual(['0.34', '0.33', '0.33']);
  });
  it('takes a percentage of what is left after line discounts', () => {
    // 1000 less 100 own discount leaves 900; 10% of the bill is 90, all on this one line
    expect(effectiveDiscounts([L('1', '1000', '100')], '10%')).toEqual(['190.00']);
  });
  it('never discounts more than the bill, and leaves unreadable input for the server to explain', () => {
    expect(effectiveDiscounts([L('1', '100')], '5000')).toEqual(['100.00']);
    expect(effectiveDiscounts([L('x', '100', '5')], '10')).toEqual(['5']);
    expect(effectiveDiscounts([L('1', '100')], 'ten')).toEqual(['']);
  });
  it('leaves lines with no discount alone', () => {
    expect(effectiveDiscounts([L('1', '100'), L('2', '50')], '')).toEqual(['', '']);
  });
  it('gives a shipping line the highest rate on the bill', () => {
    expect(shippingRateBp([500, 1800, 1200])).toBe(1800);
    expect(shippingRateBp([])).toBe(1800);
  });
});
