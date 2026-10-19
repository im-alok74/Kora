import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeDocument } from '../src/index.js';
import { docArb } from './arb.js';

const RUNS = { numRuns: 10_000 };
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe('properties over 10,000 generated invoices', () => {
  it('P1 document totals equal the sum of the lines, for every component', () => {
    fc.assert(fc.property(docArb, (d) => {
      const r = computeDocument(d);
      return r.taxablePaise === sum(r.lines.map((l) => l.taxablePaise))
        && r.cgstPaise === sum(r.lines.map((l) => l.cgstPaise))
        && r.sgstPaise === sum(r.lines.map((l) => l.sgstPaise))
        && r.igstPaise === sum(r.lines.map((l) => l.igstPaise))
        && r.cessPaise === sum(r.lines.map((l) => l.cessPaise))
        && r.lines.every((l) => l.lineTotalPaise === l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise);
    }), RUNS);
  });
  it('P2 CGST equals SGST on every line and the document; IGST and CGST never co-occur', () => {
    fc.assert(fc.property(docArb, (d) => {
      const r = computeDocument(d);
      return r.cgstPaise === r.sgstPaise
        && r.lines.every((l) => l.cgstPaise === l.sgstPaise && (l.igstPaise === 0n || l.cgstPaise === 0n))
        && (r.supply === 'intra' ? r.igstPaise === 0n : r.cgstPaise === 0n);
    }), RUNS);
  });
  it('P3 round-off is within 50 paise and the grand total is a whole rupee', () => {
    fc.assert(fc.property(docArb, (d) => {
      const r = computeDocument(d);
      const small = r.grandTotalPaise < 100n;       // under Rs 1 the total is kept exact (see TC31)
      return r.roundOffPaise >= -50n && r.roundOffPaise <= 50n && (small ? r.roundOffPaise === 0n : r.grandTotalPaise % 100n === 0n)
        && r.grandTotalPaise === r.taxablePaise + (d.reverseCharge ? 0n : r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise) + r.tcsPaise + r.roundOffPaise;
    }), RUNS);
  });
  it('P4 nothing is negative except the round-off', () => {
    fc.assert(fc.property(docArb, (d) => {
      const r = computeDocument(d);
      return [r.taxablePaise, r.cgstPaise, r.sgstPaise, r.igstPaise, r.cessPaise, r.tcsPaise, r.tdsPaise, r.grandTotalPaise, r.netReceivablePaise]
        .every((x) => x >= 0n) && r.lines.every((l) => l.grossPaise >= 0n && l.taxablePaise >= 0n);
    }), RUNS);
  });
  it('P8 the net receivable after TDS is never negative', () => {
    fc.assert(fc.property(docArb, (d) => computeDocument(d).netReceivablePaise >= 0n), RUNS);
  });
  it('P7 each line tax is within half a paisa of the exact value (independent of the rounding code)', () => {
    fc.assert(fc.property(docArb, (d) => {
      const r = computeDocument(d);
      return r.lines.every((l) => {
        const rate = BigInt(l.taxRateBp);
        const exactIgst10k = l.taxablePaise * rate;            // exact igst * 10000
        const exactCgst20k = l.taxablePaise * rate;            // exact cgst * 20000
        const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
        const igstOk = l.igstPaise === 0n || absDiff(l.igstPaise * 10000n, exactIgst10k) <= 5000n;
        const cgstOk = l.cgstPaise === 0n || absDiff(l.cgstPaise * 20000n, exactCgst20k) <= 10000n;
        const zeroOk = rate !== 0n || (l.igstPaise === 0n && l.cgstPaise === 0n);
        return igstOk && cgstOk && zeroOk;
      });
    }), RUNS);
  });
});
