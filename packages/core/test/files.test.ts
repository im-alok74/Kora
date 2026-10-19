import { describe, expect, it } from 'vitest';
import { makeXlsx, makeZip, readStoredZip, sheetName } from '../src/index.js';

describe('zip', () => {
  it('round-trips names and bytes, including non-English names and empty files', () => {
    const entries = [
      { name: 'a.txt', data: 'hello' }, { name: 'ग्राहक/नाम.csv', data: Buffer.from([0, 1, 2, 255, 254]) }, { name: 'empty.txt', data: '' },
      { name: 'big.bin', data: Buffer.alloc(300_000, 7) },
    ];
    const back = readStoredZip(makeZip(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(back[0]!.data.toString()).toBe('hello');
    expect([...back[1]!.data]).toEqual([0, 1, 2, 255, 254]);
    expect(back[2]!.data.length).toBe(0);
    expect(back[3]!.data.length).toBe(300_000);
  });
  it('detects damage', () => {
    const z = makeZip([{ name: 'a.txt', data: 'hello world' }]);
    z[z.indexOf('hello')] = 0x48;                                                // 'h' -> 'H'
    expect(() => readStoredZip(z)).toThrow(/Checksum/);
    expect(() => readStoredZip(Buffer.from('not a zip'))).toThrow();
  });
});

/** True when every tag opens and closes in order. Enough to catch a broken part, without an XML library. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, close, tag, , selfClose] = m;
    if (selfClose) continue;
    if (!close) stack.push(tag!);
    else if (stack.pop() !== tag) return false;
  }
  return stack.length === 0;
}

describe('xlsx', () => {
  const sheet = (xml: Buffer) => xml.toString('utf8');
  const parts = (b: Buffer) => Object.fromEntries(readStoredZip(b).map((e) => [e.name, e.data]));

  it('has the parts a spreadsheet program needs, and well-formed XML in each', () => {
    const p = parts(makeXlsx([{ name: 'Sales', columns: [{ key: 'a', label: 'Name' }], rows: [{ a: 'x' }] }]));
    expect(Object.keys(p).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    for (const [name, data] of Object.entries(p)) {
      const xml = sheet(data);
      expect(xml.startsWith('<?xml'), name).toBe(true);
      expect(balanced(xml), name).toBe(true);
    }
  });

  it('writes money as numbers with two decimals, text as text, and never as a formula', () => {
    const p = parts(makeXlsx([{ name: 'Sales', columns: [{ key: 'who', label: 'Customer' }, { key: 'amt', label: 'Amount', money: true }],
      rows: [{ who: '=HYPERLINK("http://x")', amt: '118000' }, { who: '@SUM(A1)', amt: '-5' }, { who: 'Tom & <Jerry>', amt: null }] }]));
    const x = sheet(p['xl/worksheets/sheet1.xml']!);
    expect(x).toContain('<c r="B2" s="2"><v>1180.00</v></c>');
    expect(x).toContain('<c r="B3" s="2"><v>-0.05</v></c>');
    expect(x).not.toContain('<f>');
    expect(x).toContain('=HYPERLINK(&quot;http://x&quot;)');                       // stored as text
    expect(x).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(x).not.toContain('r="B4"');                                              // empty cell left out
    expect(x).toContain('<pane ySplit="1"');                                        // header row stays in view
  });

  it('keeps Devanagari, drops characters XML cannot hold, and names columns past Z', () => {
    const cols = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `C${i}` }));
    const row = Object.fromEntries(cols.map((c, i) => [c.key, i === 0 ? 'नमस्ते\u0000\u0007 Ltd' : i === 27 ? 'z' : '']));
    const x = sheet(parts(makeXlsx([{ name: 'S', columns: cols, rows: [row] }]))['xl/worksheets/sheet1.xml']!);
    expect(x).toContain('नमस्ते Ltd');
    expect(x).not.toMatch(/[\u0000-\u0008]/);
    expect(x).toContain('<c r="AB2" t="inlineStr">');
    expect(x).toContain('<c r="AD1"');
  });

  it('gives sheets legal, unique names', () => {
    const taken = new Set<string>();
    expect(sheetName('Sales/Returns: [2026]', taken)).toBe('Sales Returns   2026');
    expect(sheetName('Sales/Returns: [2026]', taken)).toBe('Sales Returns   2026 2');
    expect(sheetName('x'.repeat(40), taken).length).toBe(31);
    expect(sheetName('', taken)).toBe('Sheet');
    const w = sheet(parts(makeXlsx([{ name: 'A', columns: [], rows: [] }, { name: 'a', columns: [], rows: [] }]))['xl/workbook.xml']!);
    expect(w).toContain('name="A"'); expect(w).toContain('name="a 2"');
  });
  it('refuses an empty workbook', () => { expect(() => makeXlsx([])).toThrow(); });
});
