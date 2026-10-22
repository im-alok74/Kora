import { describe, expect, it } from 'vitest';
import { code128Modules, code128Svg, code128Values } from '../lib/code128';
import { calcGst } from '../lib/gstCalc';
import { TOOLS } from '../lib/tools';

describe('GST calculator', () => {
  it('adds GST to an amount and splits it in state', () => {
    const r = calcGst('1000', 1800, 'exclusive', 'intra');
    expect(r).toMatchObject({ base: 100000n, cgst: 9000n, sgst: 9000n, igst: 0n, tax: 18000n, total: 118000n });
  });
  it('uses IGST between states', () => {
    expect(calcGst('1000', 1800, 'exclusive', 'inter')).toMatchObject({ igst: 18000n, cgst: 0n, sgst: 0n, total: 118000n });
  });
  it('takes GST out of an amount that includes it, and the parts add back up', () => {
    const r = calcGst('1180', 1800, 'inclusive', 'intra');
    expect(r.total).toBe(118000n);
    expect(r.base + r.tax).toBe(r.total);
    expect(r.base).toBe(100000n);
    const odd = calcGst('999.99', 500, 'inclusive', 'inter');
    expect(odd.base + odd.tax).toBe(odd.total);
  });
  it('refuses a rate that GST does not use', () => {
    expect(() => calcGst('100', 777, 'exclusive', 'intra')).toThrow();
  });
});

describe('Code 128', () => {
  it('matches the known check digit for a short code', () => {
    // "A": start B (104) + 'A' (33) -> (104 + 33*1) % 103 = 34
    expect(code128Values('A')).toEqual([104, 33, 34, 106]);
  });
  it('packs long digit runs in subset C', () => {
    expect(code128Values('123456')).toEqual([105, 12, 34, 56, (105 + 12 * 1 + 34 * 2 + 56 * 3) % 103, 106]);
  });
  it('switches subsets for mixed text and every symbol is 11 modules wide (13 for stop)', () => {
    const v = code128Values('AB1234xy');
    const mods = code128Modules('AB1234xy');
    expect(mods.reduce((a, b) => a + b, 0)).toBe((v.length - 1) * 11 + 13);
  });
  it('rejects empty and non-ASCII text and builds an escaped svg', () => {
    expect(() => code128Values('')).toThrow();
    expect(() => code128Values('नमस्ते')).toThrow();
    expect(code128Svg('A<B')).toContain('A&lt;B');
  });
});

describe('tool list', () => {
  it('has the eleven tools with unique addresses', () => {
    expect(TOOLS).toHaveLength(11);
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(11);
  });
});
