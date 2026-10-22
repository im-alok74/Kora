import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, LAYOUT_KEYS, sanitiseTemplate } from '../src/index.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('template settings', () => {
  it('accepts every look and font, and refuses others', () => {
    for (const layout of LAYOUT_KEYS) expect(sanitiseTemplate({ layout }).layout).toBe(layout);
    for (const font of ['sans', 'serif', 'round', 'mono']) expect(sanitiseTemplate({ font }).font).toBe(font);
    expect(() => sanitiseTemplate({ layout: 'fancy' })).toThrow(/layout/);
    expect(() => sanitiseTemplate({ font: 'comic' })).toThrow(/font/);
    expect(LAYOUT_KEYS.length).toBeGreaterThanOrEqual(11);
  });

  it('keeps a small signature image and a logo size, and refuses a wrong type or a big file', () => {
    const t = sanitiseTemplate({ signatureDataUrl: PNG, logoSize: 'large' });
    expect(t.signatureDataUrl).toBe(PNG);
    expect(t.logoSize).toBe('large');
    expect(() => sanitiseTemplate({ signatureDataUrl: 'data:image/svg+xml;base64,AAAA' })).toThrow(/PNG or JPEG/);
    expect(() => sanitiseTemplate({ signatureDataUrl: `data:image/png;base64,${'A'.repeat(140_000)}` })).toThrow(/under 100 KB/);
    expect(() => sanitiseTemplate({ logoSize: 'huge' })).toThrow(/logo size/);
  });

  it('defaults are unchanged for a business that never set anything', () => {
    expect(sanitiseTemplate({})).toEqual(DEFAULT_TEMPLATE);
    expect(DEFAULT_TEMPLATE.signatureDataUrl).toBeNull();
    expect(DEFAULT_TEMPLATE.logoSize).toBe('medium');
  });
});
