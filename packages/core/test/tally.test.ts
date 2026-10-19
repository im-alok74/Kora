import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, cancelDocument, createBusiness, createParty, exportTally, issueDocument, recordPayment, resolveTenant, saveDraft, startNote,
  ForbiddenError, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession;
let tom: string, asha: string;
const D = '2026-10-10';
const line = (rate: string, over = {}) => ({ name: 'Widget', hsnSac: '8471', quantity: '1', rate, taxRateBp: 1800, ...over });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const mk = async (over: Partial<DocIn>) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, { docType: 'tax_invoice', docDate: D, lines: [line('1000.00')], ...over })).id)).document;

interface V { type: string; number: string; party: string; date: string; entries: { ledger: string; amount: bigint; positive: boolean }[] }
function parse(xml: string): V[] {
  return [...xml.matchAll(/<VOUCHER VCHTYPE="([^"]+)"[^>]*>(.*?)<\/VOUCHER>/gs)].map((m) => {
    const body = m[2]!;
    const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return {
      type: m[1]!, number: unesc(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/.exec(body)![1]!), party: unesc(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/.exec(body)![1]!),
      date: /<DATE>(\d{8})<\/DATE>/.exec(body)![1]!,
      entries: [...body.matchAll(/<LEDGERNAME>(.*?)<\/LEDGERNAME><ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE><AMOUNT>(-?\d+\.\d\d)<\/AMOUNT>/g)]
        .map((e) => ({ ledger: unesc(e[1]!), positive: e[2] === 'No', amount: BigInt(e[3]!.replace('.', '')) })),
    };
  });
}
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (!m[1]) stack.push(m[2]!); else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

beforeAll(async () => {
  db = await makeTestDb();
  const mkUser = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [u, s] = [await mkUser('o@e.test'), await mkUser('s@e.test')];
  const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u, bid, s, 'staff');
  owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid);
  tom = await createParty(db.web, owner, { kind: 'customer', name: 'Tom & Jerry <Co> "Ltd"', stateCode: '27' });
  asha = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('Tally export', () => {
  it('writes a balanced voucher for every kind of sale, and escapes names', async () => {
    const plain = await mk({ partyId: tom, lines: [line('100.50')] });                       // each GST half is 9.045, rounded up to 9.05: 100.50 + 18.10 = 118.60, then up to 119: round off +0.40
    const inter = await mk({ partyId: asha, lines: [line('2000.00')] });                      // IGST
    const rcm = await mk({ partyId: tom, reverseCharge: true, lines: [line('500.00')] });     // tax not billed to the customer
    const tcs = await mk({ partyId: asha, tcsBp: 100, lines: [line('1000.00')] });
    const bos = await mk({ docType: 'bill_of_supply', partyId: asha, lines: [line('300.00', { taxRateBp: 0 })] });
    const noteDraft = (await startNote(db.web, owner, inter.id as string, 'credit_note')).id;
    await db.owner`update document set doc_date = ${D} where id = ${noteDraft}`;          // a note takes today's date; pin it so the range is stable
    const note = (await issueDocument(db.web, owner, noteDraft)).document;
    const cancelled = await mk({ partyId: tom });
    await cancelDocument(db.web, owner, cancelled.id, 'Entered twice');

    const out = await exportTally(db.web, owner, { from: '2026-10-01', to: '2026-10-31' });
    expect(balanced(out.xml)).toBe(true);
    expect(out.xml.startsWith('<?xml')).toBe(true);
    const vs = parse(out.xml);
    expect(vs.map((v) => v.number).sort()).toEqual([plain, inter, rcm, tcs, bos, note].map((d) => d.number as string).sort());
    expect(out.counts).toMatchObject({ sales: 5, creditNotes: 1, receipts: 0, skipped: 0, cancelledNotExported: 1 });
    for (const v of vs) {
      expect(v.entries.reduce((n, e) => n + e.amount, 0n), v.number).toBe(0n);              // every voucher balances to the paisa
      expect(v.entries.every((e) => e.positive === (e.amount > 0n)), v.number).toBe(true);   // and the Yes/No flag agrees with the sign
      expect(v.date).toBe('20261010');
    }
    const by = (d: Record<string, unknown>) => vs.find((v) => v.number === d.number)!;
    expect(by(plain).type).toBe('Sales');
    expect(by(plain).entries).toEqual([
      { ledger: 'Tom & Jerry <Co> "Ltd"', amount: -11900n, positive: false }, { ledger: 'Sales', amount: 10050n, positive: true },
      { ledger: 'Output CGST', amount: 905n, positive: true }, { ledger: 'Output SGST', amount: 905n, positive: true }, { ledger: 'Round Off', amount: 40n, positive: true }]);
    expect(by(inter).entries.map((e) => e.ledger)).toEqual(['Asha Stores', 'Sales', 'Output IGST']);
    expect(by(rcm).entries).toEqual([{ ledger: 'Tom & Jerry <Co> "Ltd"', amount: -50000n, positive: false }, { ledger: 'Sales', amount: 50000n, positive: true }]);
    expect(by(tcs).entries.find((e) => e.ledger === 'TCS Payable')).toMatchObject({ amount: 1180n, positive: true });
    expect(by(bos).entries.map((e) => e.ledger)).toEqual(['Asha Stores', 'Sales']);
    expect(by(note).type).toBe('Credit Note');
    expect(by(note).entries[0]).toMatchObject({ ledger: 'Asha Stores', amount: 236000n, positive: true });   // the customer is credited, sales debited
    expect(by(note).entries.find((e) => e.ledger === 'Sales')).toMatchObject({ amount: -200000n, positive: false });

    // names are escaped in the file itself, including the masters
    expect(out.xml).toContain('Tom &amp; Jerry &lt;Co&gt; &quot;Ltd&quot;');
    expect(out.xml).not.toContain('Tom & Jerry');
    expect(out.xml).toMatch(/<LEDGER NAME="Tom &amp; Jerry &lt;Co&gt; &quot;Ltd&quot;" ACTION="Create"><NAME>.*?<\/NAME><PARENT>Sundry Debtors<\/PARENT>/);
    expect(out.xml.indexOf('All Masters')).toBeLessThan(out.xml.indexOf('<REPORTNAME>Vouchers'));
  });

  it('writes receipts into cash, bank or the TDS ledger, and credits the customer', async () => {
    const inv = await mk({ partyId: asha, docDate: '2026-11-05', tdsBp: 1000, lines: [line('1000.00')] });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '500.00', method: 'upi', receivedOn: '2026-11-06' });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '100.00', method: 'cash', receivedOn: '2026-11-07' });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '100.00', method: 'tds', receivedOn: '2026-11-08' });
    const walkin = await mk({ partyId: null, docDate: '2026-11-05', lines: [line('50.00')] });
    await recordPayment(db.web, owner, { documentId: walkin.id as string, amount: '10.00', method: 'cash', receivedOn: '2026-11-09' });

    const out = await exportTally(db.web, owner, { from: '2026-11-01', to: '2026-11-30' });
    const receipts = parse(out.xml).filter((v) => v.type === 'Receipt');
    expect(receipts).toHaveLength(3);
    expect(out.counts).toMatchObject({ receipts: 3, skipped: 1, sales: 2 });          // the walk-in payment has no customer ledger to credit
    const into = Object.fromEntries(receipts.map((r) => [r.entries.find((e) => !e.positive)!.ledger, r.entries.find((e) => e.positive)!]));
    expect(Object.keys(into).sort()).toEqual(['Bank Account', 'Cash', 'TDS Receivable']);
    expect(into['Bank Account']).toMatchObject({ ledger: 'Asha Stores', amount: 50000n });
    for (const r of receipts) expect(r.entries.reduce((n, e) => n + e.amount, 0n)).toBe(0n);
    expect(receipts.every((r) => /^KR-[0-9a-f]{8}$/.test(r.number))).toBe(true);
  });

  it('uses the ledger names it is given, and refuses names Tally cannot take', async () => {
    const out = await exportTally(db.web, owner, { from: '2026-10-01', to: '2026-10-31', config: { company: 'Acme (2026-27)', salesLedger: 'Sales - GST', cgstLedger: 'CGST Out' } });
    expect(out.xml).toContain('<SVCURRENTCOMPANY>Acme (2026-27)</SVCURRENTCOMPANY>');
    expect(parse(out.xml)[0]!.entries.some((e) => e.ledger === 'Sales - GST')).toBe(true);
    expect(parse(out.xml).flatMap((v) => v.entries).some((e) => e.ledger === 'CGST Out')).toBe(true);
    expect(await fails(exportTally(db.web, owner, { from: '2026-10-01', to: '2026-10-31', config: { salesLedger: 'x'.repeat(101) } }))).toBeInstanceOf(ValidationError);
    expect(await fails(exportTally(db.web, owner, { from: '2026-10-01', to: '2026-10-31', config: { salesLedger: 'bad\u0001name' } }))).toBeInstanceOf(ValidationError);
  });

  it('honours the dates, and needs real ones', async () => {
    const empty = await exportTally(db.web, owner, { from: '2025-01-01', to: '2025-01-31' });
    expect(parse(empty.xml)).toHaveLength(0);
    expect(balanced(empty.xml)).toBe(true);
    for (const bad of [{}, { from: '2026-10-01' }, { from: 'x', to: '2026-10-31' }, { from: '2026-11-01', to: '2026-10-01' }]) {
      expect(await fails(exportTally(db.web, owner, bad))).toBeInstanceOf(ValidationError);
    }
  });

  it('is for owners and accountants, and each export is logged', async () => {
    expect(await fails(exportTally(db.web, staff, { from: '2026-10-01', to: '2026-10-31' }))).toBeInstanceOf(ForbiddenError);
    const log = await db.owner`select detail from data_export where kind = 'tally' order by created_at desc limit 1`;
    expect(log[0]!.detail).toHaveProperty('sales');
  });
});
