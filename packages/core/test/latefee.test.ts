import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, createBusiness, createLateFeeDebitNote, createParty, deleteDraft, getDocument, getLateFeeConfig, issueDocument, lateFee, lateFeeStatus,
  recordPayment, resolveTenant, saveDraft, saveLateFeeConfig, sanitiseLateFeeConfig, ForbiddenError, ValidationError, type LateFeeConfig, type TenantSession,
} from '../src/index.js';

const pct = (over: Partial<LateFeeConfig> = {}): LateFeeConfig => ({ enabled: true, mode: 'percent_per_month', value: 200, graceDays: 7, gstRateBp: 1800, ...over });

describe('late fee arithmetic', () => {
  const base = { outstandingPaise: 1_000_000n, dueDate: '2026-10-01', chargedThrough: null, chargedBefore: false };
  it('charges a percentage a month, pro rata by the day, from the end of the grace period', () => {
    // due 1 Oct, 7 days grace, so charging starts 8 Oct; to 31 Oct is 23 days. 2% a month of Rs 10,000 for 23 days.
    expect(lateFee({ ...base, today: '2026-10-31', cfg: pct() })).toEqual({ days: 23, feePaise: 15333n });
    expect(lateFee({ ...base, today: '2026-10-08', cfg: pct() }).feePaise).toBe(0n);        // grace period only just over
    expect(lateFee({ ...base, today: '2026-10-09', cfg: pct() })).toEqual({ days: 1, feePaise: 667n });   // 666.67 rounds up
    expect(lateFee({ ...base, today: '2026-10-05', cfg: pct() })).toEqual({ days: 0, feePaise: 0n });
    expect(lateFee({ ...base, today: '2026-11-07', cfg: pct({ graceDays: 0 }) })).toEqual({ days: 37, feePaise: 24667n });
  });
  it('never charges the same day twice', () => {
    const second = lateFee({ ...base, today: '2026-11-07', cfg: pct(), chargedThrough: '2026-10-31', chargedBefore: true });
    expect(second.days).toBe(7);
    expect(second.feePaise).toBe(4667n);
    expect(lateFee({ ...base, today: '2026-10-31', cfg: pct(), chargedThrough: '2026-10-31', chargedBefore: true }).feePaise).toBe(0n);
  });
  it('charges a flat fee once, and nothing on a paid or not-yet-late invoice', () => {
    const flat = pct({ mode: 'flat', value: 50_000 });
    expect(lateFee({ ...base, today: '2026-10-20', cfg: flat })).toEqual({ days: 12, feePaise: 50_000n });
    expect(lateFee({ ...base, today: '2026-11-20', cfg: flat, chargedThrough: '2026-10-20', chargedBefore: true }).feePaise).toBe(0n);
    expect(lateFee({ ...base, outstandingPaise: 0n, today: '2026-12-31', cfg: pct() }).feePaise).toBe(0n);
    expect(lateFee({ ...base, today: '2026-09-01', cfg: pct() }).feePaise).toBe(0n);
  });
  it('lowers the fee when part of the invoice has been paid', () => {
    const full = lateFee({ ...base, today: '2026-10-31', cfg: pct() }).feePaise;
    const half = lateFee({ ...base, outstandingPaise: 500_000n, today: '2026-10-31', cfg: pct() }).feePaise;
    expect(half).toBe(7667n);
    expect(half * 2n - full).toBeLessThanOrEqual(1n);
  });
  it('refuses settings that make no sense', () => {
    for (const bad of [{ mode: 'weekly' }, { value: 0 }, { value: 1001 }, { value: 1.5 }, { graceDays: -1 }, { graceDays: 91 }, { gstRateBp: 5000 }, { mode: 'flat', value: 999_999_999 }]) {
      expect(() => sanitiseLateFeeConfig({ ...pct(), ...bad })).toThrow(ValidationError);
    }
    expect(sanitiseLateFeeConfig({}).enabled).toBe(false);
  });
});

describe('late fee debit notes', () => {
  let db: TestDb;
  let owner: TenantSession, accountant: TenantSession;
  let buyer: string;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
  const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
  const overdue = async (daysLate: number, rate = '1000.00') => {
    const { id } = await saveDraft(db.web, owner, {
      docType: 'tax_invoice', partyId: buyer, docDate: addDays(today(), -daysLate - 10), dueDate: addDays(today(), -daysLate),
      lines: [{ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' }],
    });
    await issueDocument(db.web, owner, id);
    return id;
  };

  beforeAll(async () => {
    db = await makeTestDb();
    const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
    const [a] = await db.owner`insert into app_user (email) values ('a@example.test') returning id`;
    const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, u!.id as string, bid, a!.id as string, 'accountant');
    owner = await resolveTenant(db.web, u!.id as string, bid);
    accountant = await resolveTenant(db.web, a!.id as string, bid);
    buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Slow Payer', stateCode: '27' });
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('is off until the owner switches it on, and only an owner may', async () => {
    expect((await getLateFeeConfig(db.web, owner)).enabled).toBe(false);
    const id = await overdue(40);
    expect(await lateFeeStatus(db.web, owner, id)).toMatchObject({ eligible: false, reason: expect.stringContaining('switched off') });
    expect((await fails(createLateFeeDebitNote(db.web, owner, id))).message).toMatch(/switched off/);
    await expect(saveLateFeeConfig(db.web, accountant, pct())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await saveLateFeeConfig(db.web, owner, pct())).toEqual(pct());
    expect(await getLateFeeConfig(db.web, owner)).toEqual(pct());
  });

  it('makes a draft debit note for the fee that has built up, once, and charges tax on it', async () => {
    const id = await overdue(40);                                       // 33 days past the grace period; Rs 1,180 outstanding
    const s = await lateFeeStatus(db.web, accountant, id);              // an accountant can see it
    expect(s).toMatchObject({ eligible: true, days: 33, feePaise: '2596', outstandingPaise: '118000' });
    await expect(createLateFeeDebitNote(db.web, accountant, id)).rejects.toBeInstanceOf(ForbiddenError);

    const made = await createLateFeeDebitNote(db.web, owner, id);
    expect(made).toMatchObject({ alreadyDrafted: false, feePaise: '2596' });
    const note = (await getDocument(db.web, owner, made.id))!;
    expect(note.document).toMatchObject({ doc_type: 'debit_note', status: 'draft', original_document_id: id, party_id: buyer, taxable_paise: '2596' });
    expect(note.document.grand_total_paise).toBe('3100');               // 25.96 plus 18% GST (4.67) is 30.63, rounded to the nearest rupee like any invoice
    expect(note.lines[0]).toMatchObject({ hsn_sac: '999799', tax_rate_bp: 1800 });
    expect(String(note.lines[0]!.item_name)).toContain('33 days');
    // asking again returns the same draft, not a second one
    expect(await createLateFeeDebitNote(db.web, owner, id)).toMatchObject({ id: made.id, alreadyDrafted: true });
    expect((await db.owner`select count(*)::int as n from late_fee_charge where invoice_id = ${id}`)[0]!.n).toBe(1);

    // issued, the days are charged: nothing more is due until more days pass
    await issueDocument(db.web, owner, made.id);
    expect(await lateFeeStatus(db.web, owner, id)).toMatchObject({ eligible: false, days: 0, reason: 'No late fee has built up yet.' });
    expect((await lateFeeStatus(db.web, owner, id)).charges).toHaveLength(1);
    expect(await fails(createLateFeeDebitNote(db.web, owner, id))).toBeInstanceOf(ValidationError);
  });

  it('forgets a charge when its draft is deleted, so the days can be charged again', async () => {
    const id = await overdue(20);
    const made = await createLateFeeDebitNote(db.web, owner, id);
    await deleteDraft(db.web, owner, made.id);
    expect((await lateFeeStatus(db.web, owner, id)).charges).toHaveLength(0);
    expect((await lateFeeStatus(db.web, owner, id)).eligible).toBe(true);
    expect((await createLateFeeDebitNote(db.web, owner, id)).alreadyDrafted).toBe(false);
  });

  it('has no fee for a paid invoice, one inside its grace period, or one with no due date', async () => {
    const paid = await overdue(30);
    await recordPayment(db.web, owner, { documentId: paid, amount: '1180.00', method: 'cash' });
    expect(await lateFeeStatus(db.web, owner, paid)).toMatchObject({ eligible: false, reason: 'This invoice is paid.' });
    const fresh = await overdue(3);
    expect(await lateFeeStatus(db.web, owner, fresh)).toMatchObject({ eligible: false, reason: 'No late fee has built up yet.' });
    const { id: nodue } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [{ name: 'X', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800 }] });
    await issueDocument(db.web, owner, nodue);
    expect(await lateFeeStatus(db.web, owner, nodue)).toMatchObject({ eligible: false, reason: expect.stringContaining('no due date') });
    expect(await fails(lateFeeStatus(db.web, owner, '00000000-0000-0000-0000-000000000000'))).toBeInstanceOf(ValidationError);
  });
});
