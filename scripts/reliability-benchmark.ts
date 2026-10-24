/** Local baseline only. Creates and drops a random fully migrated test database; never uses DATABASE_URL. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { makeTestDb } from '../packages/db/src/testing.js';
import { ageingReport, createBusiness, createParty, issueDocument, recordPayment, resolveTenant, saveDraft } from '../packages/core/src/index.js';
import { closePdfBrowser, renderPdf, renderSample } from '../packages/pdf/src/index.js';

const db = await makeTestDb();
const samples: Record<string, number[]> = {};
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  (samples[name] ??= []).push(performance.now() - start);
  return result;
}
try {
  const [u] = await db.owner`insert into app_user(email) values ('benchmark@example.test') returning id`;
  const businessId = await createBusiness(db.web, u!.id as string, { legalName: 'Benchmark', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  const tenant = await resolveTenant(db.web, u!.id as string, businessId);
  const partyId = await createParty(db.web, tenant, { kind: 'customer', name: 'Benchmark customer', stateCode: '27' });
  // Six waves of four clients, each creating and partially paying one ten-line invoice.
  for (let wave = 0; wave < 6; wave++) {
    await Promise.all(Array.from({ length: 4 }, async (_, slot) => {
      const draft = await timed('save_10_lines', () => saveDraft(db.web, tenant, {
        docType: 'tax_invoice', partyId, docDate: '2026-10-24', dueDate: '2026-11-24',
        lines: Array.from({ length: 10 }, (_, i) => ({ name: `Service ${i}`, hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800 })),
      }));
      await timed('issue', () => issueDocument(db.web, tenant, draft.id));
      const input = { documentId: draft.id, amount: '100', method: 'cash', operationKey: `benchmark-${wave}-${slot}-operation` };
      const payment = await timed('payment', () => recordPayment(db.web, tenant, input));
      assert.deepEqual(await timed('payment_replay', () => recordPayment(db.web, tenant, input)), payment);
    }));
  }
  for (let i = 0; i < 24; i++) await timed('ageing_24_invoices', () => ageingReport(db.web, tenant, { asOf: '2026-10-24' }));
  const [counts] = await db.owner`select (select count(*)::int from document where status = 'issued') as invoices,
    (select count(*)::int from payment) as payments, (select sum(amount_paise)::text from payment) as collected`;
  assert.equal(counts!.invoices, 24); assert.equal(counts!.payments, 24); assert.equal(counts!.collected, '240000');
  const html = renderSample({ legal_name: 'Benchmark', state_code: '27' }, { layout: 'classic', accent: '#106cd9', font: 'sans' });
  for (let i = 0; i < 9; i++) {
    const pdf = await timed(i === 0 ? 'pdf_cold' : 'pdf_warm', () => renderPdf(html));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  }
  const percentile = (values: number[], fraction: number) => Math.round(values[Math.ceil(values.length * fraction) - 1]! * 10) / 10;
  console.log(JSON.stringify({ date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    memoryGiB: Math.round(totalmem() / 1024 ** 3), processRssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
    workload: { businesses: 1, clients: 4, invoices: 24, linesPerInvoice: 10, pdf: 'one-page sample, serial, 1 cold + 8 warm' },
    note: 'Local service timings include DB work, exclude HTTP/provider latency. Small sample p99 is effectively the maximum. Chromium RSS and pool wait are not measured.',
    results: Object.fromEntries(Object.entries(samples).map(([name, values]) => {
      values.sort((a, b) => a - b);
      return [name, { n: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99) }];
    })), correctness: '24 issued invoices, 24 payments despite replay, 240000 paise collected, valid PDF headers',
  }, null, 2));
} finally {
  await closePdfBrowser();
  await db.drop();
}
