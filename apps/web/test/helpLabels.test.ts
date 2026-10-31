import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES } from '../lib/help';
// @ts-expect-error plain JavaScript module, also run directly with node
import { findPlaceholders } from '../../../scripts/launch-check.mjs';

/**
 * The help centre tells people to press buttons by name. When a screen is renamed the article goes stale without anyone noticing,
 * as "Register e-invoice" did. Each label below is quoted by an article and must still be written in the screen that has it.
 * Add a row when an article starts quoting a new button.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABELS: [label: string, file: string][] = [
  ['New invoice', 'app/app/invoices/page.tsx'],
  ['Save draft', 'components/DocumentEditor.tsx'],
  ['Copy link', 'app/app/invoices/[id]/page.tsx'],
  ['Send history', 'app/app/invoices/[id]/page.tsx'],
  ['Record payment', 'app/app/invoices/[id]/page.tsx'],
  ['Send reminder', 'app/app/invoices/[id]/page.tsx'],
  ['Credit note', 'app/app/invoices/[id]/page.tsx'],
  ['Debit note', 'app/app/invoices/[id]/note/page.tsx'],
  ['Convert to invoice', 'app/app/invoices/[id]/page.tsx'],
  ['Resubmit e-invoice', 'app/app/invoices/[id]/page.tsx'],
  ['Cancel e-invoice', 'app/app/invoices/[id]/page.tsx'],
  ['Register my invoices as e-invoices', 'app/app/settings/page.tsx'],
  ['Send reminders automatically', 'app/app/settings/page.tsx'],
  ['Save reminder settings', 'app/app/settings/page.tsx'],
  ['Invite a person', 'app/app/team/page.tsx'],
  ['Send invitation', 'app/app/team/page.tsx'],
  ['Download backup (ZIP)', 'app/app/data/page.tsx'],
  ['Download Excel file', 'app/app/data/page.tsx'],
  ['Download Tally file', 'app/app/data/page.tsx'],
  ['Download GSTR-1 JSON', 'app/app/reports/page.tsx'],
  ['Make the e-way bill', 'components/EwayPanel.tsx'],
  ['Download JSON for the portal', 'components/EwayPanel.tsx'],
  ['Stop this link', 'app/app/customers/page.tsx'],
  ['Email it', 'app/app/customers/page.tsx'],
  ['Add customer', 'app/app/customers/page.tsx'],
  ['Add an expense', 'app/app/expenses/page.tsx'],
  ['Save expense', 'app/app/expenses/page.tsx'],
  ['Print receipt', 'app/app/pos/page.tsx'],
  ['Try it with sample data', 'app/app/page.tsx'],
  ['Add as a bill', 'app/app/itc/page.tsx'],
];

const helpText = HELP_ARTICLES.flatMap((a) => [a.summary, ...a.body, ...(a.steps ?? [])]).join('\n');

describe('help articles quote real button names', () => {
  for (const [label, file] of LABELS) {
    it(`"${label}" is in ${file}`, () => {
      expect(helpText, `no help article quotes "${label}" any more; remove this row`).toContain(label);
      expect(readFileSync(join(web, file), 'utf8'), `"${label}" is not written in ${file}`).toContain(label);
    });
  }

  it('does not mention a button that is known not to exist', () => {
    for (const gone of ['Register e-invoice', 'Choose Invite', 'Try with sample data']) expect(helpText).not.toContain(gone);
  });
});

describe('launch-check placeholder finder', () => {
  it('finds placeholder addresses, values and prices with their line numbers', () => {
    const found = findPlaceholders([
      { path: 'a.tsx', text: 'fine\nmail support@kora.example now\n<b>[number of days to be decided]</b>' },
      { path: 'b.tsx', text: '<span>Placeholder price</span>' },
      { path: 'c.tsx', text: 'nothing here' },
    ]);
    expect(found.map((f: { path: string; line: number }) => `${f.path}:${f.line}`)).toEqual(['a.tsx:2', 'a.tsx:3', 'b.tsx:1']);
  });

  it('finds nothing in clean text', () => {
    expect(findPlaceholders([{ path: 'x.ts', text: 'const a = 1;' }])).toEqual([]);
  });
});
