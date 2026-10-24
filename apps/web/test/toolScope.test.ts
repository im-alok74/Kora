import { describe, expect, it } from 'vitest';
// @ts-expect-error next.config.mjs is plain JavaScript without types
import config, { REMOVED_TOOL_SLUGS } from '../next.config.mjs';
import { KORA_CTA, SIGNUP_HREF } from '../lib/toolKora';
import { hasOwnCopy, toolPageInfo } from '../lib/toolPages';
import { RELATED } from '../lib/toolPagesCalc';
import { REMOVED_TOOLS, TOOLS, toolBySlug } from '../lib/tools';

// The free tools are limited to what a Kora customer uses while invoicing, taxing, pricing, shopping or collecting.
// Dropping or adding a tool is a decision for the owner: these tests make a change here visible in review.
const KEPT = [
  'gst-calculator', 'invoice-generator', 'quotation-maker', 'proforma-invoice-generator', 'purchase-order-generator', 'receipt-maker',
  'qr-code-generator', 'barcode-generator', 'qr-code-scanner', 'barcode-scanner', 'logo-maker', 'profit-margin-calculator',
  'emi-calculator', 'interest-calculator', 'gstin-validator', 'amount-in-words',
];

describe('which tools are on the site', () => {
  it('is exactly the tools that relate to Kora, and none of the removed ones', () => {
    expect(TOOLS.map((t) => t.slug).sort()).toEqual([...KEPT].sort());
    for (const s of REMOVED_TOOLS) expect(toolBySlug(s), s).toBeUndefined();
  });
  it('gives every remaining tool copy of its own, not the generic fallback', () => {
    const generic = new Set<string>();
    for (const t of TOOLS) {
      expect(hasOwnCopy(t.slug), `${t.slug} has no copy of its own`).toBe(true);
      const info = toolPageInfo(t);
      expect(info.about, t.slug).toBeTruthy();
      expect(info.faq.length, t.slug).toBeGreaterThanOrEqual(5);
      expect(info.crossText.length, t.slug).toBeGreaterThan(30);
      expect(generic.has(info.lead), `${t.slug} shares its lead with another tool`).toBe(false);
      generic.add(info.lead);
    }
  });
  it('mentions no removed tool anywhere in the page copy', () => {
    const words = /pdf to image|image converter|image compressor|images to pdf|merge and split|merge pdf|word counter|keyword density/i;
    for (const t of TOOLS) {
      const text = JSON.stringify(toolPageInfo(t)) + t.title + t.summary;
      expect(text, t.slug).not.toMatch(words);
      for (const r of RELATED[t.slug] ?? []) expect(REMOVED_TOOLS as readonly string[]).not.toContain(r);
    }
  });
});

describe('the sign-up call to action under each tool', () => {
  it('exists for every tool, is specific to it, and goes to the sign-up page', () => {
    expect(SIGNUP_HREF).toBe('/login?signup=1');
    const seen = new Set<string>();
    for (const t of TOOLS) {
      const c = KORA_CTA[t.slug];
      expect(c, `${t.slug} has no Kora call to action`).toBeTruthy();
      expect(c!.title.length).toBeGreaterThan(10);
      expect(c!.text.length).toBeGreaterThan(40);
      expect(c!.button.length).toBeGreaterThan(8);
      expect(seen.has(c!.title), `${t.slug} repeats a title`).toBe(false);
      seen.add(c!.title);
      expect(JSON.stringify(c)).not.toMatch(/—|\d+%|\d+ ?(lakh|crore|users|customers)/i);   // no dashes of the long kind, no invented figures
    }
    for (const slug of Object.keys(KORA_CTA)) expect(toolBySlug(slug), `${slug} is not a tool`).toBeTruthy();
  });
});

describe('addresses of removed tools', () => {
  it('the redirect list matches the removed tools and is permanent (308) to the hub', async () => {
    expect([...REMOVED_TOOL_SLUGS].sort()).toEqual([...REMOVED_TOOLS].sort());
    const rules = await (config as { redirects: () => Promise<{ source: string; destination: string; permanent: boolean }[]> }).redirects();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ destination: '/tools', permanent: true });
    for (const s of REMOVED_TOOLS) expect(rules[0]!.source, s).toContain(s);
  });
  it('no kept tool shares its address with a removed one', () => {
    for (const t of TOOLS) expect(REMOVED_TOOLS as readonly string[]).not.toContain(t.slug);
  });
});

describe('GST facts in the tool copy', () => {
  it('names the current slabs and dates the old 12 and 28 percent rates', () => {
    const gst = JSON.stringify(toolPageInfo(toolBySlug('gst-calculator')!));
    expect(gst).toContain('0%, 5%, 18% or 40%');
    expect(gst).toContain('3% on gold');
    expect(gst).toContain('0.25%');
    expect(gst).toContain('22 September 2025');
  });
});
