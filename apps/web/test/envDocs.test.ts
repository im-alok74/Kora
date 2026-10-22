import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every environment variable the code reads must be written down in .env.example (set or commented out), so the production
 * checklist in docs/launch-checklist.md can never miss one. Variables set by the platform or used only by tests are listed here.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'test-results', 'playwright-report', 'test', 'tests']);
const PLATFORM_OR_TEST_ONLY = new Set([
  'NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NEXT_RUNTIME', 'NEXT_DIST_DIR', 'PORT', 'COLOR', 'CI',
  'KORA_E2E_REUSE', 'TEST_ADMIN_URL', 'BASE', 'HOME', 'PATH',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP_DIRS.has(n) || n.startsWith('.next')) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function variablesInCode(): Map<string, string> {
  const found = new Map<string, string>();
  for (const area of ['apps/web', 'apps/worker', 'apps/mock-gsp', 'packages']) {
    for (const file of walk(join(root, area)).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith('.test.ts'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|\benv\.([A-Z][A-Z0-9_]{3,})\b/g)) {
        const name = (m[1] ?? m[2])!;
        if (!found.has(name)) found.set(name, file.slice(root.length + 1));
      }
    }
  }
  return found;
}

describe('.env.example', () => {
  it('names every variable the code reads', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    const missing = [...variablesInCode()].filter(([n]) => !PLATFORM_OR_TEST_ONLY.has(n) && !documented.has(n)).map(([n, f]) => `${n} (read in ${f})`);
    expect(missing, 'add these to .env.example with a one-line explanation').toEqual([]);
  });

  it('holds no real-looking secrets', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    for (const line of example.split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!m) continue;
      if (/KEY|SECRET|TOKEN|PASSPHRASE|PASSWORD/.test(m[1]!)) expect(m[2]!.length, `${m[1]} should be empty or a short local placeholder`).toBeLessThan(60);
    }
  });
});
