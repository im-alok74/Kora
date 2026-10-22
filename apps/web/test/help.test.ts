import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, HELP_CATEGORIES, bySlug, searchHelp } from '../lib/help';

describe('help centre articles', () => {
  it('have unique slugs and known categories', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of HELP_ARTICLES) expect(HELP_CATEGORIES).toContain(a.category);
  });

  it('only link to articles that exist, and not to themselves', () => {
    for (const a of HELP_ARTICLES) {
      for (const r of a.related) {
        expect(bySlug(r), `${a.slug} links to missing ${r}`).toBeDefined();
        expect(r).not.toBe(a.slug);
      }
    }
  });

  it('have a title, a summary and at least one paragraph', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.title.length).toBeGreaterThan(3);
      expect(a.summary.length).toBeGreaterThan(10);
      expect(a.body.length).toBeGreaterThan(0);
    }
  });

  it('use no em dashes and no placeholder text', () => {
    for (const a of HELP_ARTICLES) {
      const text = [a.title, a.summary, ...a.body, ...(a.steps ?? [])].join('\n');
      expect(text, a.slug).not.toMatch(/[\u2014\u2013]/);
      expect(text, a.slug).not.toMatch(/TODO|lorem|TBD/i);
    }
  });

  it('can be found by search', () => {
    expect(searchHelp('whatsapp').map((a) => a.slug)).toContain('send-on-whatsapp');
    expect(searchHelp('e-way')[0]?.slug).toBe('e-way-bills');
  });
});
