import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { withTenant } from '@kora/db';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { computeDocument, gstinCheckChar, gstinValid, STATE_NAMES } from '../src/index.js';
import { docArb } from './arb.js';

let db: TestDb;
const USER = '00000000-0000-0000-0000-0000000000a1';
let biz: string;
let partyIntra: string, partyInter: string;

beforeAll(async () => {
  db = await makeTestDb();
  await db.owner`insert into app_user (id, email) values (${USER}, 'o@example.test')`;
  const [{ id }] = (await db.web`select create_business(${USER}, 'Acme Traders', '27AAPFU0939F1ZV', '27', 'regular') as id`) as any;
  biz = id;
  await withTenant(db.web, { businessId: biz, userId: USER }, async (tx: any) => {
    await tx`insert into number_series (business_id, doc_type, prefix, financial_year, pad_width)
             values (${biz}, 'tax_invoice', 'T/', fy_label(current_date), 6)`;
    [{ id: partyIntra }] = (await tx`insert into party (business_id, kind, name, state_code) values (${biz}, 'customer', 'Local', '27') returning id`) as any;
    [{ id: partyInter }] = (await tx`insert into party (business_id, kind, name, state_code) values (${biz}, 'customer', 'Far', '29') returning id`) as any;
  });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('state names', () => {
  it('match the state_code table in the database exactly', async () => {
    const rows = await db.owner`select code, name from state_code order by code`;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.name]))).toEqual(STATE_NAMES);
  });
});

describe('TC26 the TypeScript GSTIN check agrees with gstin_valid() in the database', () => {
  const U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', A = U + '0123456789';
  const pick = (s: string) => fc.integer({ min: 0, max: s.length - 1 }).map((i) => s[i]!);
  const body = fc.tuple(
    fc.integer({ min: 1, max: 38 }).map((n) => String(n).padStart(2, '0')),
    fc.stringOf(pick(U), { minLength: 5, maxLength: 5 }), fc.stringOf(pick('0123456789'), { minLength: 4, maxLength: 4 }),
    pick(U), pick(U + '123456789'),
  ).map(([s, l, d, e, n]) => `${s}${l}${d}${e}${n}Z`);
  const gstins = fc.oneof(
    body.map((b) => b + gstinCheckChar(b)),                     // correct check character
    fc.tuple(body, pick(A)).map(([b, c]) => b + c),             // random check character
    fc.string({ maxLength: 18 }),                               // junk
  );
  it('agrees on 1,000 random strings', async () => {
    const sample = fc.sample(gstins, 1000);
    const rows = await db.owner`select g, gstin_valid(g) as ok from unnest(${sample}::text[]) as g`;
    expect(rows).toHaveLength(1000);
    for (const r of rows) expect(gstinValid(r.g as string)).toBe(r.ok);
    expect(rows.some((r) => r.ok)).toBe(true);
    expect(rows.some((r) => !r.ok)).toBe(true);
  });
});

describe('P6 the database accepts every document the library produces', () => {
  it('issues 200 random documents without a single rejection', async () => {
    const docs = fc.sample(docArb, 200);
    let n = 0;
    for (const d of docs) {
      const r = computeDocument(d);
      await withTenant(db.web, { businessId: biz, userId: USER }, async (tx: any) => {
        const [{ id }] = (await tx`
          insert into document (business_id, doc_type, party_id, place_of_supply, reverse_charge, taxable_paise, cgst_paise, sgst_paise,
                                igst_paise, cess_paise, tcs_paise, tds_paise, round_off_paise, grand_total_paise)
          values (${biz}, 'tax_invoice', ${r.supply === 'intra' ? partyIntra : partyInter}, ${d.placeOfSupply}, ${d.reverseCharge ?? false},
                  ${r.taxablePaise}, ${r.cgstPaise}, ${r.sgstPaise}, ${r.igstPaise}, ${r.cessPaise}, ${r.tcsPaise}, ${r.tdsPaise},
                  ${r.roundOffPaise}, ${r.grandTotalPaise}) returning id`) as any;
        let pos = 0;
        for (const l of r.lines) {
          const src = d.lines[pos]!;
          pos++;
          await tx`insert into document_line (business_id, document_id, position, item_name, hsn_sac, quantity, rate_paise, gross_paise,
                     discount_paise, taxable_paise, tax_rate_bp, cess_rate_bp, cgst_paise, sgst_paise, igst_paise, cess_paise, line_total_paise)
                   values (${biz}, ${id}, ${pos}, 'Item', '8471', ${(Number(src.quantityMilli) / 1000).toFixed(3)}, ${src.ratePaise}, ${l.grossPaise},
                     ${l.discountPaise}, ${l.taxablePaise}, ${l.taxRateBp}, ${l.cessRateBp}, ${l.cgstPaise}, ${l.sgstPaise}, ${l.igstPaise},
                     ${l.cessPaise}, ${l.lineTotalPaise})`;
        }
        await tx`update document set status = 'issued' where id = ${id}`;     // the trigger re-checks totals against lines
      });
      n++;
    }
    expect(n).toBe(200);
    const [c] = await db.owner`select count(*)::int as n, max(number) as last from document where status = 'issued'`;
    expect(c).toMatchObject({ n: 200, last: 'T/000200' });
  }, 120_000);
});
