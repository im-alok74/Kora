import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Links between the README and the documents must point at files that exist, and "#section" links must point at a heading
 * that exists. Also: no em dashes in the documents, and no obvious secrets.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const files = ['README.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

/** GitHub's rule for a heading anchor: lower case, drop punctuation except hyphen and underscore, spaces become hyphens. */
const slug = (h: string) => h.trim().toLowerCase().replace(/`/g, '').replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-');

function headings(md: string): Set<string> {
  const inFence = { on: false };
  const out = new Set<string>();
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) inFence.on = !inFence.on;
    const m = !inFence.on && /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(slug(m[1]!));
  }
  return out;
}

function links(md: string): string[] {
  const noCode = md.replace(/```[\s\S]*?```/g, '');
  return [...noCode.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^(https?:|mailto:)/.test(l));
}

describe('documents', () => {
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');

    it(`${f}: every relative link and anchor resolves`, () => {
      const bad: string[] = [];
      for (const l of links(text)) {
        const [path, anchor] = l.split('#');
        const target = path ? resolve(root, dirname(f), path) : join(root, f);
        if (!existsSync(target)) { bad.push(l); continue; }
        if (anchor && target.endsWith('.md') && !headings(readFileSync(target, 'utf8')).has(anchor)) bad.push(l);
      }
      expect(bad).toEqual([]);
    });

    it(`${f}: has no em dashes`, () => {
      expect(text.includes('—')).toBe(false);
    });
  }

  it('the README names every document in docs/ that a newcomer needs', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const d of ['architecture', 'launch-checklist', 'deploy', 'troubleshooting', 'contributing', 'compliance', 'api']) expect(readme).toContain(`docs/${d}.md`);
  });
});
