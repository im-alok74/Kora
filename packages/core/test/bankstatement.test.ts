import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, bankApply, bankPreview, createBill, createBusiness, createParty, fingerprint, getDocument, issueDocument, matchRow, parseStatement, parseStatementAmount,
  parseStatementCsv, parseStatementDate, resolveTenant, saveDraft, type StatementRow, type TenantSession,
} from '../src/index.js';

describe('reading a statement', () => {
  it('reads dates in the formats banks use', () => {
    expect(parseStatementDate('25/10/2026')).toBe('2026-10-25');
    expect(parseStatementDate('25-10-26')).toBe('2026-10-25');
    expect(parseStatementDate('2026-10-25')).toBe('2026-10-25');
    expect(parseStatementDate('25 Oct 2026')).toBe('2026-10-25');
    expect(parseStatementDate('25-Oct-2026')).toBe('2026-10-25');
    expect(parseStatementDate('5/1/2027')).toBe('2027-01-05');
    expect(parseStatementDate('31/02/2026')).toBeNull();                         // not a real day
    expect(parseStatementDate('hello')).toBeNull();
    expect(parseStatementDate('')).toBeNull();
  });
  it('reads amounts with commas, symbols, brackets and Dr or Cr', () => {
    expect(parseStatementAmount('1,23,456.78')).toBe(12345678n);
    expect(parseStatementAmount('Rs. 500')).toBe(50000n);
    expect(parseStatementAmount('₹ 2,000.50')).toBe(200050n);
    expect(parseStatementAmount('(250.00)')).toBe(25000n);
    expect(parseStatementAmount('500.00 Cr')).toBe(50000n);
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('-')).toBeNull();
    expect(parseStatementAmount('abc')).toBeNull();
  });
  it('handles quotes, commas inside quotes, and other separators', () => {
    expect(parseStatementCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseStatementCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseStatementCsv('﻿a\tb\r\n1\t2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('finds the header below a bank preamble and reads separate debit and credit columns', () => {
    const csv = [
      'Account Statement', 'Account No,50200012345678', 'Period,01/10/2026 to 31/10/2026', '',
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '05/10/26,"NEFT-HDFC-MEHTA TEXTILES-INV/26-27/0042",N123456,05/10/26,,"11,800.00","1,11,800.00"',
      '07/10/26,UPI-ACME STEEL-PAYMENT,U998877,07/10/26,"5,000.00",,"1,06,800.00"',
      'Opening balance,,,,,,',
      '09/10/26,,,,,,',
    ].join('\n');
    const r = parseStatement(csv);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(r.rows[0]).toMatchObject({ date: '2026-10-05', creditPaise: 1180000n, debitPaise: 0n, reference: 'N123456' });
    expect(r.rows[0]!.description).toContain('MEHTA TEXTILES');
    expect(r.rows[1]).toMatchObject({ date: '2026-10-07', creditPaise: 0n, debitPaise: 500000n });
  });
  it('reads one amount column with a Dr or Cr type column', () => {
    const csv = 'Txn Date,Description,Amount,Dr/Cr\n2026-10-05,Receipt from Iyer,"1,000.00",CR\n2026-10-06,Vendor payment,"250.00",DR\n';
    const r = parseStatement(csv);
    expect(r.rows.map((x) => [x.creditPaise, x.debitPaise])).toEqual([[100000n, 0n], [0n, 25000n]]);
  });
  it('says what is wrong with a file that is not a statement', () => {
    expect(parseStatement('hello\nworld').problems[0]).toMatch(/header row/);
    expect(parseStatement('Date,Narration,Balance\n01/01/2026,x,100').problems[0]).toMatch(/debit, credit or amount/);
  });
  it('gives the same fingerprint for the same line and a different one when anything changes', () => {
    const base = { date: '2026-10-05', description: 'NEFT Mehta', creditPaise: 100n, debitPaise: 0n, reference: 'R1' };
    expect(fingerprint(base)).toBe(fingerprint({ ...base, description: 'neft  mehta' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, creditPaise: 101n }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, date: '2026-10-06' }));
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('matching a line to an open invoice or bill', () => {
  const row = (over: Partial<StatementRow>): StatementRow => ({ index: 0, date: '2026-10-05', description: '', creditPaise: 0n, debitPaise: 0n, reference: '', ...over });
  const invoices = [
    { id: 'i1', number: 'INV/26-27/0042', party: 'Mehta Textiles Pvt Ltd', duePaise: 1180000n },
    { id: 'i2', number: 'INV/26-27/0043', party: 'Sharma Electricals', duePaise: 1180000n },
    { id: 'i3', number: 'INV/26-27/0044', party: 'Iyer and Co', duePaise: 500000n },
  ];
  it('puts the invoice named in the narration first when two invoices have the same amount', () => {
    const s = matchRow(row({ creditPaise: 1180000n, description: 'NEFT-MEHTA TEXTILES-INV/26-27/0042' }), invoices, []);
    expect(s[0]).toMatchObject({ id: 'i1', kind: 'invoice' });
    expect(s[0]!.reasons).toEqual(expect.arrayContaining(['The amount is exactly what is due', 'The invoice number is in the narration', 'The name is in the narration']));
    expect(s[0]!.score).toBeGreaterThan(s[1]!.score);
  });
  it('recognises a short form of the number and a name alone', () => {
    expect(matchRow(row({ creditPaise: 1180000n, description: 'UPI payment INV 43 sharma' }), invoices, [])[0]).toMatchObject({ id: 'i2' });
    expect(matchRow(row({ creditPaise: 1180000n, description: 'cheque deposit Sharma Electricals' }), invoices, [])[0]).toMatchObject({ id: 'i2' });
  });
  it('suggests on amount alone but marks it as the only reason, and suggests nothing for an amount nobody owes', () => {
    const s = matchRow(row({ creditPaise: 500000n, description: 'cash deposit' }), invoices, []);
    expect(s).toHaveLength(1);
    expect(s[0]!.reasons).toEqual(['The amount is exactly what is due']);
    expect(matchRow(row({ creditPaise: 123n, description: 'cash deposit' }), invoices, [])).toEqual([]);
  });
  it('allows a part payment only when the narration points at the invoice, and never more than is due', () => {
    expect(matchRow(row({ creditPaise: 400000n, description: 'part payment INV/26-27/0044 iyer' }), invoices, [])[0]).toMatchObject({ id: 'i3' });
    expect(matchRow(row({ creditPaise: 400000n, description: 'random' }), invoices, [])).toEqual([]);
    expect(matchRow(row({ creditPaise: 999999999n, description: 'INV/26-27/0044 iyer' }), invoices, [])).toEqual([]);
  });
  it('matches money out to vendor bills, never to invoices', () => {
    const bills = [{ id: 'b1', billNumber: 'GS/0001', vendor: 'Gujarat Steel', duePaise: 250000n }];
    expect(matchRow(row({ debitPaise: 250000n, description: 'NEFT Gujarat Steel GS/0001' }), invoices, bills)[0]).toMatchObject({ id: 'b1', kind: 'bill' });
    expect(matchRow(row({ debitPaise: 1180000n, description: 'to Mehta' }), invoices, bills)).toEqual([]);
  });
});

describe('recording matched lines', () => {
  let db: TestDb;
  let owner: TenantSession, accountant: TenantSession, other: TenantSession, invoiceId: string, billId: string;
  beforeAll(async () => {
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [o, a, x] = [await mk('o@b.test'), await mk('a@b.test'), await mk('x@b.test')];
    const bid = await createBusiness(db.web, o, { legalName: 'Bank Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, o, bid, a, 'accountant');
    owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
    other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
    const c = await createParty(db.web, owner, { kind: 'customer', name: 'Mehta Textiles', stateCode: '27' });
    const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: c, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate: '10000', taxRateBp: 1800, kind: 'service' }] });
    await issueDocument(db.web, owner, d.id);
    invoiceId = d.id;
    const v = await createParty(db.web, owner, { kind: 'vendor', name: 'Gujarat Steel', stateCode: '24' });
    billId = (await createBill(db.web, owner, { partyId: v, billNumber: 'GS/0001', billDate: '2026-10-01', lines: [{ description: 'Steel', hsnSac: '7214', quantity: '1', rate: '2500', taxRateBp: 0 }] })).id;
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  const csv = [
    'Date,Narration,Withdrawal Amt.,Deposit Amt.',
    '05/10/2026,"NEFT MEHTA TEXTILES INV/26-27/0001","","11,800.00"',
    '06/10/2026,NEFT GUJARAT STEEL GS/0001,"2,500.00",',
    '07/10/2026,CASH DEPOSIT,,"777.00"',
  ].join('\n');

  it('previews with suggestions for the two lines that match and none for the third', async () => {
    const p = await bankPreview(db.web, owner, csv);
    expect(p.problems).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]!.suggestions[0]).toMatchObject({ kind: 'invoice', id: invoiceId });
    expect(p.rows[1]!.suggestions[0]).toMatchObject({ kind: 'bill', id: billId });
    expect(p.rows[2]!.suggestions).toEqual([]);
    expect(p.rows.every((r) => !r.alreadyRecorded)).toBe(true);
  });
  it('records the confirmed lines, marks the invoice paid and the bill settled, and refuses to record a line twice', async () => {
    const p = await bankPreview(db.web, owner, csv);
    const items = [
      { kind: 'invoice' as const, id: invoiceId, amount: '11800.00', date: p.rows[0]!.date!, description: p.rows[0]!.description, fingerprint: p.rows[0]!.fingerprint },
      { kind: 'bill' as const, id: billId, amount: '2500.00', date: p.rows[1]!.date!, description: p.rows[1]!.description, fingerprint: p.rows[1]!.fingerprint },
    ];
    const r = await bankApply(db.web, owner, items);
    expect(r).toMatchObject({ done: 2, failed: 0 });
    expect((await getDocument(db.web, owner, invoiceId))!.document).toMatchObject({ payment_status: 'paid', amount_settled_paise: '1180000' });
    expect((await db.owner`select paid_paise from purchase_bill where id = ${billId}`)[0]!.paid_paise).toBe('250000');
    const again = await bankApply(db.web, owner, items);
    expect(again).toMatchObject({ done: 0, failed: 2 });
    expect(again.results[0]!.error).toMatch(/already been recorded/);
    const after = await bankPreview(db.web, owner, csv);
    expect(after.rows[0]!.alreadyRecorded).toBe(true);
    expect(after.rows[0]!.suggestions).toEqual([]);
  });
  it('lets one bad line fail without stopping the rest, and tells the person why', async () => {
    const r = await bankApply(db.web, owner, [
      { kind: 'invoice', id: invoiceId, amount: '1.00', date: '2026-10-08', description: 'late', fingerprint: 'aaaaaaaaaaaa' },
      { kind: 'bill', id: '00000000-0000-0000-0000-000000000000', amount: '1.00', date: '2026-10-08', description: 'x', fingerprint: 'bbbbbbbbbbbb' },
      { kind: 'invoice', id: invoiceId, amount: '1.00', date: '2026-10-08', description: 'bad', fingerprint: 'not-a-print' },
    ]);
    expect(r.failed).toBe(3);
    expect(r.results[0]!.error).toMatch(/already paid/);
    expect(r.results[2]!.error).toMatch(/could not be identified/);
  });
  it('is closed to an accountant who may only read, and to other businesses', async () => {
    const p = await bankPreview(db.web, accountant, csv);
    expect(p.rows).toHaveLength(3);
    const r = await bankApply(db.web, accountant, [{ kind: 'invoice', id: invoiceId, amount: '1.00', date: '2026-10-08', description: 'x', fingerprint: 'cccccccccccc' }]);
    expect(r.failed).toBe(1);
    const o = await bankPreview(db.web, other, csv);
    expect(o.rows.every((x) => x.suggestions.length === 0)).toBe(true);
    await expect(bankPreview(db.web, owner, '')).rejects.toThrow(/Choose a statement/);
  });
});
