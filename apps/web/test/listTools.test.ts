import { beforeEach, describe, expect, it } from 'vitest';
import { csvText, deleteView, loadViews, rupeesPlain, saveView } from '../lib/listTools';

describe('csv for a spreadsheet', () => {
  it('escapes quotes, commas and line breaks', () => {
    expect(csvText(['A', 'B'], [['x, y', 'say "hi"'], ['line\nbreak', 'plain']])).toBe('﻿A,B\r\n"x, y","say ""hi"""\r\n"line\nbreak",plain\r\n');
  });
  it('stops a name from running as a formula', () => {
    const t = csvText(['Name'], [['=HYPERLINK("http://evil")'], ['+1'], ['-2'], ['@SUM(A1)'], ['\tcmd'], ['fine']]);
    expect(t).toContain("'=HYPERLINK");
    expect(t).toContain("'+1");
    expect(t).toContain("'-2");
    expect(t).toContain("'@SUM");
    expect(t).toContain('fine');
    expect(t).not.toMatch(/\r\n=/);
  });
  it('writes numbers, empties and bigints plainly', () => {
    expect(csvText(['n'], [[5], [null], [undefined], [10n]])).toBe('﻿n\r\n5\r\n\r\n\r\n10\r\n');
  });
  it('turns paise into plain rupees, negatives included', () => {
    expect(rupeesPlain('118000')).toBe('1180.00');
    expect(rupeesPlain(5n)).toBe('0.05');
    expect(rupeesPlain('-250')).toBe('-2.50');
    expect(rupeesPlain('0')).toBe('0.00');
  });
});

describe('saved views', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as any).window = { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } };
  });
  it('saves, replaces by name regardless of case, and deletes', () => {
    expect(saveView('docs', 'Overdue', { q: 'a' })).toEqual([{ name: 'Overdue', state: { q: 'a' } }]);
    saveView('docs', 'Drafts', { q: 'b' });
    expect(saveView('docs', 'overdue', { q: 'c' })!.map((v) => v.name)).toEqual(['Drafts', 'overdue']);
    expect(loadViews('docs')).toHaveLength(2);
    expect(deleteView('docs', 'Drafts').map((v) => v.name)).toEqual(['overdue']);
  });
  it('keeps lists apart, ignores a blank name, and survives damaged or blocked storage', () => {
    saveView('docs', 'A', { x: 1 });
    expect(loadViews('customers')).toEqual([]);
    expect(saveView('docs', '   ', { x: 1 })).toBeNull();
    mem.set('kora.views.docs', '{not json');
    expect(loadViews('docs')).toEqual([]);
    mem.set('kora.views.docs', JSON.stringify([{ name: 5 }, { name: 'ok', state: {} }, null]));
    expect(loadViews('docs').map((v) => v.name)).toEqual(['ok']);
    (globalThis as any).window = { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } };
    expect(loadViews('docs')).toEqual([]);
    expect(saveView('docs', 'B', {})).toBeNull();
  });
  it('keeps at most twenty views and trims long names', () => {
    for (let i = 0; i < 25; i++) saveView('docs', `v${i}`, {});
    expect(loadViews('docs')).toHaveLength(20);
    expect(saveView('docs', 'x'.repeat(100), {})!.at(-1)!.name).toHaveLength(40);
  });
});
