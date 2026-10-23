import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { gstinCheckChar } from '@kora/tax';
import { amountToWords, hindiNumber } from '../lib/amountWords';
import { inspectGstin } from '../lib/gstinInfo';
import { extractPages, imagesToPdf, mergePdfs, parsePageGroups, parsePageList, PdfProblem, rotatePages } from '../lib/pdfOps';
import { fitToSize, formatBytes } from '../lib/sizeTarget';
import { analyseText, minutesLabel, tokenize } from '../lib/textStats';
import { TOOLS, TOOL_GROUPS } from '../lib/tools';
import { toolPageInfo } from '../lib/toolPages';

const withCheck = (first14: string) => first14 + gstinCheckChar(first14);

describe('GSTIN validator', () => {
  const good = withCheck('27AAAPL1234C1Z');
  it('accepts a good number and decodes it', () => {
    const r = inspectGstin(good);
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.state).toEqual({ code: '27', name: 'Maharashtra' });
    expect(r.pan).toBe('AAAPL1234C');
    expect(r.holder).toBe('Individual');
    expect(r.entity).toBe('1');
  });
  it('tidies spaces, dashes and lower case', () => {
    expect(inspectGstin(` ${good.slice(0, 2).toLowerCase()}-${good.slice(2)} `).valid).toBe(true);
  });
  it('explains a wrong check character with the expected one', () => {
    const wrong = good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A');
    const r = inspectGstin(wrong);
    expect(r.valid).toBe(false);
    expect(r.checkChar?.expected).toBe(good[14]);
    expect(r.problems.join(' ')).toContain(`should be ${good[14]}`);
  });
  it('reports length, state code, PAN shape and the Z', () => {
    expect(inspectGstin('').problems[0]).toMatch(/Enter a GSTIN/);
    expect(inspectGstin('27AAAPL1234C1Z').problems[0]).toMatch(/15 characters\. This one has 14/);
    expect(inspectGstin(withCheck('98AAAPL1234C1Z')).problems.join(' ')).toMatch(/98 is not a GST state code/);
    expect(inspectGstin('27AAPF10939F1Z5').problems.join(' ')).toMatch(/must be a PAN/);
    expect(inspectGstin(withCheck('27AAAPL1234C1X')).problems.join(' ')).toMatch(/must be the letter Z/);
    expect(inspectGstin('27AAAPL1234C0ZX').problems.join(' ')).toMatch(/cannot be 0/);
    expect(inspectGstin('27AAAPL1234C1Z#').problems.join(' ')).toMatch(/only letters and digits/);
  });
  it('names the holder from the fourth PAN letter', () => {
    expect(inspectGstin(withCheck('29AABCU9603R1Z')).holder).toBe('Company');
    expect(inspectGstin(withCheck('29AABHU9603R1Z')).holder).toBe('Hindu Undivided Family');
  });
});

describe('Amount in words', () => {
  const ok = (s: string) => { const r = amountToWords(s); if (!r.ok) throw new Error(r.error); return r; };
  it('uses the lakh and crore system in English', () => {
    expect(ok('1,23,45,678.50').english).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only');
    expect(ok('100000').english).toBe('Rupees One Lakh Only');
    expect(ok('0.50').english).toBe('Paise Fifty Only');
    expect(ok('0').english).toBe('Rupees Zero Only');
  });
  it('writes Hindi numbers with the right irregular forms', () => {
    expect(hindiNumber(0)).toBe('शून्य');
    expect(hindiNumber(21)).toBe('इक्कीस');
    expect(hindiNumber(99)).toBe('निन्यानवे');
    expect(hindiNumber(100)).toBe('एक सौ');
    expect(hindiNumber(1000)).toBe('एक हज़ार');
    expect(hindiNumber(123456)).toBe('एक लाख तेईस हज़ार चार सौ छप्पन');
    expect(hindiNumber(10000000)).toBe('एक करोड़');
    expect(ok('1250.50').hindi).toBe('एक हज़ार दो सौ पचास रुपये और पचास पैसे केवल');
    expect(ok('1').hindi).toBe('एक रुपया केवल');
    expect(ok('0.01').hindi).toBe('एक पैसा केवल');
    expect(ok('0').hindi).toBe('शून्य रुपये केवल');
  });
  it('has a name for every number from 0 to 99 and no two the same', () => {
    const all = Array.from({ length: 100 }, (_, i) => hindiNumber(i));
    expect(new Set(all).size).toBe(100);
  });
  it('groups the digits the Indian way', () => {
    expect(ok('1234567.5').digits).toBe('Rs 12,34,567.50');
    expect(ok('999').digits).toBe('Rs 999.00');
  });
  it('accepts a Rs prefix and rejects bad input with plain messages', () => {
    expect(ok('Rs. 500').english).toBe('Rupees Five Hundred Only');
    expect(ok('₹ 1,000').english).toBe('Rupees One Thousand Only');
    for (const bad of ['', 'abc', '12.345', '-5', '1e5']) expect(amountToWords(bad).ok).toBe(false);
    expect(amountToWords('-5')).toEqual({ ok: false, error: 'The amount cannot be negative.' });
    expect(amountToWords('10000000000')).toMatchObject({ ok: false });
    expect(amountToWords('9999999999.99').ok).toBe(true);
  });
});

describe('Word counter and keyword density', () => {
  const text = 'Cotton kurta for men. Soft cotton kurta, made in India. Buy the cotton kurta online!';
  it('counts words, sentences and characters', () => {
    const s = analyseText(text);
    expect(s.words).toBe(15);
    expect(s.sentences).toBe(3);
    expect(s.characters).toBe(text.length);
    expect(s.charactersNoSpaces).toBe(text.replace(/\s/g, '').length);
    expect(s.paragraphs).toBe(1);
  });
  it('ranks keywords by count with density as a percent of all words', () => {
    const s = analyseText(text, { stopWords: true });
    expect(s.keywords[0]).toEqual({ text: 'cotton', count: 3, density: 20 });
    expect(s.keywords[1]).toMatchObject({ text: 'kurta', count: 3 });
    expect(s.keywords.find((k) => k.text === 'the')).toBeUndefined();
    expect(analyseText(text, { stopWords: false, limit: 50 }).keywords.some((k) => k.text === 'the')).toBe(true);
  });
  it('finds repeated phrases and never starts or ends one with a stop word', () => {
    const s = analyseText(text, { stopWords: true });
    expect(s.twoWord[0]).toEqual({ text: 'cotton kurta', count: 3, density: 20 });
    expect(s.twoWord.every((p) => p.count >= 2)).toBe(true);
    const t = analyseText('the red box and the red box', { stopWords: true });
    expect(t.twoWord.map((p) => p.text)).toEqual(['red box']);
  });
  it('handles empty text, numbers, apostrophes and Hindi', () => {
    const e = analyseText('');
    expect(e).toMatchObject({ words: 0, sentences: 0, paragraphs: 0, characters: 0, readingMinutes: 0, keywords: [] });
    expect(tokenize("It's 2024, don’t panic")).toEqual(["It's", '2024', 'don’t', 'panic']);
    expect(analyseText('12 34 56').keywords).toEqual([]);
    const hi = analyseText('यह एक अच्छा उत्पाद है। यह सस्ता है।');
    expect(hi.words).toBe(8);
    expect(hi.sentences).toBe(2);
  });
  it('splits paragraphs on blank lines and estimates reading time', () => {
    expect(analyseText('One.\n\nTwo.\n\n\nThree.').paragraphs).toBe(3);
    expect(analyseText('word '.repeat(400)).readingMinutes).toBe(2);
    expect(minutesLabel(2.5)).toBe('2 min 30 sec');
    expect(minutesLabel(0.1)).toBe('6 sec');
  });
});

describe('size target search', () => {
  // Fake encoder: bytes grow with the square of the scale and linearly with quality.
  const fake = (full: number) => async (scale: number, q: number | null) => ({ out: { scale, q }, size: Math.round(full * scale * scale * (q ?? 1)) });
  it('keeps full size and the highest quality when the picture already fits', async () => {
    const r = await fitToSize(fake(100_000), 200_000, { lossy: true });
    expect(r).toMatchObject({ met: true, scale: 1, quality: 0.92, tries: 1 });
  });
  it('finds the highest quality that fits, within a small step', async () => {
    const r = await fitToSize(fake(400_000), 150_000, { lossy: true });
    expect(r.met).toBe(true);
    expect(r.size).toBeLessThanOrEqual(150_000);
    expect(r.scale).toBe(1);
    expect(r.quality!).toBeGreaterThan(0.36);          // the true answer is 0.375
    expect(r.quality!).toBeLessThanOrEqual(0.375);
  });
  it('shrinks the picture when lowest quality is still too big, and says so when nothing fits', async () => {
    const r = await fitToSize(fake(1_000_000), 100_000, { lossy: true });
    expect(r.met).toBe(true);
    expect(r.scale).toBeLessThan(1);
    expect(r.size).toBeLessThanOrEqual(100_000);
    const none = await fitToSize(fake(1_000_000), 10, { lossy: true });
    expect(none.met).toBe(false);
    expect(none.scale).toBe(0.25);
  });
  it('for PNG (no quality) only changes the size', async () => {
    const r = await fitToSize(fake(500_000), 200_000, { lossy: false });
    expect(r).toMatchObject({ met: true, quality: null });
    expect(r.scale).toBe(0.55);
  });
  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(2.5 * 1048576)).toBe('2.50 MB');
  });
});

describe('PDF operations', () => {
  const make = async (pages: number, size: [number, number] = [200, 300]) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < pages; i++) d.addPage(size);
    return new Uint8Array(await d.save());
  };
  const count = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();
  it('parses page lists and groups', () => {
    expect(parsePageList('1-3, 5, 8-', 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(parsePageList('3,1', 5)).toEqual([2, 0]);
    expect(parsePageList('-2', 5)).toEqual([0, 1]);
    expect(parsePageGroups('1-2, 4', 5)).toEqual([[0, 1], [3]]);
    for (const bad of ['', '0', '6', '3-2', 'x', '1-9', '2-4-6']) expect(() => parsePageList(bad, 5), bad).toThrow(PdfProblem);
  });
  it('merges, extracts and rotates', async () => {
    const a = await make(2), b = await make(3);
    const merged = await mergePdfs([{ name: 'a.pdf', bytes: a }, { name: 'b.pdf', bytes: b }]);
    expect(await count(merged)).toBe(5);
    const part = await extractPages(merged, [4, 0]);
    expect(await count(part)).toBe(2);
    const turned = await PDFDocument.load(await rotatePages(merged, [0, 1], 90));
    expect(turned.getPage(0).getRotation().angle).toBe(90);
    expect(turned.getPage(2).getRotation().angle).toBe(0);
    const twice = await PDFDocument.load(await rotatePages(new Uint8Array(await turned.save()), [0], 270));
    expect(twice.getPage(0).getRotation().angle).toBe(0);
  });
  it('says plainly when a file is not a PDF or has no pages', async () => {
    await expect(mergePdfs([{ name: 'x.pdf', bytes: new TextEncoder().encode('hello') }])).rejects.toMatchObject({ reason: 'broken' });
    await expect(mergePdfs([])).rejects.toMatchObject({ reason: 'empty' });
  });
  it('builds a PDF from pictures with the right page sizes', async () => {
    // 1x1 pixel PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const wide = { bytes: png, type: 'png' as const, width: 400, height: 200 };
    const tall = { bytes: png, type: 'png' as const, width: 200, height: 400 };
    const auto = await PDFDocument.load(await imagesToPdf([wide, tall], { size: 'a4', margin: 20 }));
    expect(auto.getPageCount()).toBe(2);
    expect(auto.getPage(0).getWidth()).toBeCloseTo(841.89, 1);
    expect(auto.getPage(1).getWidth()).toBeCloseTo(595.28, 1);
    const fit = await PDFDocument.load(await imagesToPdf([wide], { size: 'fit', margin: 10 }));
    expect([fit.getPage(0).getWidth(), fit.getPage(0).getHeight()]).toEqual([420, 220]);
    await expect(imagesToPdf([], { size: 'a4', margin: 0 })).rejects.toMatchObject({ reason: 'empty' });
  });
});

describe('the tool list', () => {
  it('keeps the original slugs, has unique slugs, and every tool has a known group and its own page copy', () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of ['gst-calculator', 'invoice-generator', 'logo-maker', 'barcode-scanner']) expect(slugs).toContain(s);
    for (const t of TOOLS) {
      expect(TOOL_GROUPS).toContain(t.group);
      const info = toolPageInfo(t);
      expect(info.faq.length, t.slug).toBeGreaterThanOrEqual(4);
      expect(info.about, t.slug).toBeTruthy();
      expect(JSON.stringify(info), t.slug).not.toContain('—');
    }
  });
});
