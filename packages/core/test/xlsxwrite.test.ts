import { describe, expect, it } from 'vitest';
import { readXlsx, tableToXlsx, writeXlsx } from '../src/index.js';

describe('writing an Excel workbook', () => {
  it('reads back through the same reader the importer uses', () => {
    const buf = tableToXlsx(['Name', 'Amount', 'City'], [['Asha & <Sons>', 1180.5, 'Pune'], ['Bimal "Traders"', '2,000.00', null]], 'Customers');
    expect(readXlsx(buf)).toEqual([['Name', 'Amount', 'City'], ['Asha & <Sons>', '1180.5', 'Pune'], ['Bimal "Traders"', '2,000.00']]);
  });
  it('keeps a leading formula character from running as a formula', () => {
    const rows = readXlsx(writeXlsx([['Name'], ['=HYPERLINK("http://x")'], ['-5'], ['+91 98765']]));
    expect(rows[1]![0]).toBe(`'=HYPERLINK("http://x")`);
    expect(rows[2]![0]).toBe('-5');
    expect(rows[3]![0]).toBe(`'+91 98765`);
  });
  it('handles many columns and a header only', () => {
    const wide = Array.from({ length: 30 }, (_, i) => `c${i}`);
    expect(readXlsx(writeXlsx([wide]))[0]).toEqual(wide);
  });
  it('starts with the zip signature, so a spreadsheet program recognises it', () => {
    expect(writeXlsx([['a']]).subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
  });
});
