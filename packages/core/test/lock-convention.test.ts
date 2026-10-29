import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit finding C-13: correctness depends on `select ... for update` before reading a total and writing against it.
// A behavioural race test is in credit-race.test.ts; this one stops the lock being deleted in a tidy-up, and names where it matters.
const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
const body = (file: string, fn: string) => {
  const s = src(file), i = s.indexOf(`function ${fn}`);
  expect(i, `${fn} not found in ${file}`).toBeGreaterThan(-1);
  return s.slice(i, i + 4000);
};

describe('functions that read a total and then decide must lock the row that owns it', () => {
  it.each([
    ['documents.ts', 'creditHeadroom', /from document where id = \$\{originalId\} for update/],
    ['payments.ts', 'recordPayment', /from document where id = \$\{i\.documentId\} for update/],
    ['credit.ts', 'applyCredit', /from document where id = \$\{i\.documentId\} for update/],
  ])('%s %s', (file, fn, re) => {
    expect(body(file, fn)).toMatch(re);
  });
});
