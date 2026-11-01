import { describe, expect, it } from 'vitest';
import { gstinCheckChar } from '@kora/tax';
import { amountToWords, hindiNumber } from '../lib/amountWords';
import { inspectGstin } from '../lib/gstinInfo';
import { fitToSize, formatBytes } from '../lib/sizeTarget';
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
    expect(inspectGstin(withCheck('98AAAPL1234C1Z')).valid).toBe(false);   // right check character, but no such state
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
