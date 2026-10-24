// A warning list of things that must change before real customers: placeholder text and addresses on public pages.
// It is a checklist helper, not a CI gate, because it stays red until the owner supplies real wording and prices.
//
//   node scripts/launch-check.mjs            prints warnings, always exits 0
//   node scripts/launch-check.mjs --strict   exits 1 when anything is found (for a final release check)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATTERNS = [
  { re: /@kora\.example/g, why: 'placeholder email address' },
  { re: /to be decided\]/gi, why: 'placeholder value in square brackets' },
  { re: /Placeholder price/g, why: 'placeholder price' },
  { re: /replace with your [a-z' ]+ before launch/gi, why: 'an instruction to replace text before launch' },
];

/** Pure: finds placeholders in a list of { path, text }. */
export function findPlaceholders(files) {
  const out = [];
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        if (p.re.test(line)) out.push({ path: f.path, line: i + 1, why: p.why, text: line.trim().slice(0, 120) });
      }
    });
  }
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (['node_modules', '.next', 'test'].includes(n) || n.startsWith('.next')) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function scan() {
  const files = ['apps/web/app', 'apps/web/components', 'apps/web/lib']
    .flatMap((d) => walk(join(root, d)))
    .filter((f) => /\.(tsx?|mdx?)$/.test(f))
    .map((f) => ({ path: relative(root, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));
  return findPlaceholders(files);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = scan();
  if (found.length === 0) console.log('No placeholder text found on public pages.');
  else {
    console.log(`${found.length} placeholder(s) to replace before real customers:`);
    for (const f of found) console.log(`  ${f.path}:${f.line}  (${f.why})  ${f.text}`);
  }
  if (process.argv.includes('--strict') && found.length > 0) process.exit(1);
}
