import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { excelSerialToIso, makeXlsx, makeZip, readXlsx, rowsToCsv } from '../src/index.js';

/** A small workbook written by hand, the way Excel writes one: shared strings, a date style, and a sparse row. */
function handmade(opts: { deflate?: boolean } = {}): Buffer {
  const wrap = (xml: string) => (opts.deflate ? deflateRawSync(Buffer.from(xml)) : Buffer.from(xml));
  const parts: { name: string; xml: string }[] = [
    { name: '[Content_Types].xml', xml: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/workbook.xml', xml: '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" sheetId="1" r:id="rId7"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', xml: '<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/data.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', xml: '<sst><si><t>Name</t></si><si><t>Date</t></si><si><t>Amount</t></si><si><r><t>Mehta </t></r><r><t>&amp; Sons</t></r></si><si><t xml:space="preserve">  spaced  </t></si></sst>' },
    { name: 'xl/styles.xml', xml: '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/data.xml', xml: '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="1"><v>46315</v></c><c r="C2"><v>11800.5</v></c></row>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>Inline &lt;one&gt;</t></is></c><c r="C4" s="2"><v>46000</v></c><c r="D4" t="b"><v>1</v></c></row>'
      + '<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" t="str"><v>formula result</v></c></row>'
      + '</sheetData></worksheet>' },
  ];
  const zip = makeZip(parts.map((p) => ({ name: p.name, data: wrap(p.xml) })));
  if (opts.deflate) {
    // makeZip stores without compression; mark every part as deflated so the reader inflates it, as it must for a workbook from Excel
    for (let at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])); at >= 0; at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), at + 4)) zip.writeUInt16LE(8, at + 8);
    for (let at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) zip.writeUInt16LE(8, at + 10);
  }
  return zip;
}

describe('reading an Excel workbook', () => {
  it('turns Kora\'s own export back into the same rows', () => {
    const buf = makeXlsx([{ name: 'Customers', columns: [{ key: 'name', label: 'Name' }, { key: 'gstin', label: 'GSTIN' }, { key: 'due', label: 'Due', money: true }],
      rows: [{ name: 'Asha & Co', gstin: '27AAPFU0939F1ZV', due: '118000' }, { name: '=HYPERLINK("x")', gstin: '', due: '5' }] }]);
    expect(readXlsx(buf)).toEqual([['Name', 'GSTIN', 'Due'], ['Asha & Co', '27AAPFU0939F1ZV', '1180.00'], ['=HYPERLINK("x")', '', '0.05']]);
  });
  it('reads shared strings, rich text, dates, gaps and booleans from a workbook written by hand', () => {
    for (const deflate of [false, true]) {
      const rows = readXlsx(handmade({ deflate }));
      expect(rows[0]).toEqual(['Name', 'Date', 'Amount']);
      expect(rows[1]).toEqual(['Mehta & Sons', '2026-10-20', '11800.5']);          // a date style turns 46315 into a date
      expect(rows[2]).toEqual([]);                                                    // row 3 is missing
      expect(rows[3]).toEqual(['Inline <one>', '', '2025-12-09', 'TRUE']);            // a gap becomes an empty cell, a custom date format is read
      expect(rows[4]).toEqual(['  spaced  ', 'formula result']);
    }
  });
  it('knows Excel\'s day numbers', () => {
    expect(excelSerialToIso(1)).toBe('1900-01-01');
    expect(excelSerialToIso(61)).toBe('1900-03-01');                                  // Excel counts a 29 February 1900 that never happened
    expect(excelSerialToIso(45292)).toBe('2024-01-01');
    expect(excelSerialToIso(46315)).toBe('2026-10-20');
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(NaN)).toBeNull();
  });
  it('turns rows into CSV the existing importer reads', () => {
    expect(rowsToCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"\r\n');
  });
  it('refuses a file that is not a workbook, a damaged one, and one that is too large', () => {
    expect(() => readXlsx(Buffer.from('name,gstin\nA,B'))).toThrow(/does not look like an Excel/);
    expect(() => readXlsx(Buffer.alloc(0))).toThrow(/does not look like an Excel/);
    const good = handmade();
    expect(() => readXlsx(good.subarray(0, 60))).toThrow(/Excel/);
    expect(() => readXlsx(makeZip([{ name: 'hello.txt', data: 'hi' }]))).toThrow(/does not look like an Excel/);
    expect(() => readXlsx(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow(/larger than 10 MB/);
  });
  it('does not expand a part that claims to be enormous', () => {
    const buf = Buffer.from(handmade());
    // raise the stated size of every part past the limit
    for (let at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) buf.writeUInt32LE(400 * 1024 * 1024, at + 24);
    expect(() => readXlsx(buf)).toThrow(/far larger|does not look|damaged/);
  });
  it('stops at too many rows', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`).join('');
    const big = makeZip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${rows}</sheetData></worksheet>` },
    ]);
    expect(() => readXlsx(big)).toThrow(/more than 5000 rows/);
  });
});
