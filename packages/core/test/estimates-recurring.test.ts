import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, convertEstimate, createBusiness, createParty, createRecurring, decideEstimate, deleteDraft, deleteRecurring, firstOccurrenceOnOrAfter,
  getDocument, getRecurring, issueDocument, listDocuments, listRecurring, occurrenceDate, processDueRecurring, resolveTenant, saveDraft,
  setRecurringActive, updateRecurring, ForbiddenError, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession;
let buyer: string, buyerNoPhone: string;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const line = (over = {}) => ({ name: 'Retainer', hsnSac: '998313', quantity: '1', rate: '1000.00', taxRateBp: 1800, kind: 'service' as const, ...over });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

const estimate = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'estimate', partyId: buyer, lines: [line({ rate: '2500.00' })], ...over });
const issuedEstimate = async (over: Partial<DocIn> = {}) => {
  const { id } = await saveDraft(db.web, owner, estimate(over));
  await issueDocument(db.web, owner, id);
  return id;
};
const recurring = (over = {}) => ({ name: 'Monthly retainer', partyId: buyer, unit: 'week' as const, startDate: addDays(today(), -14), lines: [line()], mode: 'issue' as const, ...over });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  const [a] = await db.owner`insert into app_user (email) values ('acct@example.test') returning id`;
  await addMember(db.web, owner.userId, bid, a!.id as string, 'accountant');
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', phone: '9876543210' });
  buyerNoPhone = await createParty(db.web, owner, { kind: 'customer', name: 'No Phone Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('schedule dates', () => {
  it('keeps a month-end start on month ends, and returns to the 31st', () => {
    const d = (k: number) => occurrenceDate('2026-01-31', 1, 'month', k);
    expect([d(0), d(1), d(2), d(3)]).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDate('2028-01-31', 1, 'month', 1)).toBe('2028-02-29');   // leap year
  });
  it('handles weeks, years, and every-n', () => {
    expect(occurrenceDate('2026-10-19', 2, 'week', 3)).toBe('2026-11-30');
    expect(occurrenceDate('2028-02-29', 1, 'year', 1)).toBe('2029-02-28');
    expect(occurrenceDate('2026-11-15', 3, 'month', 2)).toBe('2027-05-15');
    expect(occurrenceDate('2026-12-01', 1, 'month', 1)).toBe('2027-01-01');
  });
  it('finds the next date that has not passed', () => {
    expect(firstOccurrenceOnOrAfter('2026-01-15', 1, 'month', '2026-03-16')).toEqual({ k: 3, date: '2026-04-15' });
    expect(firstOccurrenceOnOrAfter('2026-01-15', 1, 'month', '2026-03-15')).toEqual({ k: 2, date: '2026-03-15' });
  });
});

describe('estimates', () => {
  it('is open until answered, and accepting or declining does not change the estimate', async () => {
    const id = await issuedEstimate({ dueDate: addDays(today(), 10) });
    const before = await getDocument(db.web, owner, id);
    expect(before!.estimate).toMatchObject({ status: 'open', decision: null });
    expect((await decideEstimate(db.web, owner, id, 'accepted')).estimate).toMatchObject({ status: 'accepted' });
    expect((await decideEstimate(db.web, owner, id, 'declined')).estimate).toMatchObject({ status: 'declined' });
    const after = await getDocument(db.web, owner, id);
    expect(after!.document.number).toBe(before!.document.number);
    expect(after!.document.grand_total_paise).toBe(before!.document.grand_total_paise);
    const list = await listDocuments(db.web, owner, { type: 'estimate' });
    expect(list.find((r) => r.id === id)).toMatchObject({ estimate_status: 'declined' });
  });

  it('turns into a draft invoice with the same customer and total, once', async () => {
    const id = await issuedEstimate({ lines: [line({ rate: '4000.00', quantity: '2' }), line({ name: 'Setup', rate: '500.00' })] });
    const first = await convertEstimate(db.web, owner, id);
    expect(first.alreadyConverted).toBe(false);
    const draft = await getDocument(db.web, owner, first.id);
    const est = await getDocument(db.web, owner, id);
    expect(draft!.document).toMatchObject({ doc_type: 'tax_invoice', status: 'draft', party_id: buyer, grand_total_paise: est!.document.grand_total_paise });
    expect(draft!.lines).toHaveLength(2);
    expect(est!.estimate).toMatchObject({ status: 'invoiced', converted_to_id: first.id });
    // a second press returns the same draft, not a second invoice
    expect(await convertEstimate(db.web, owner, id)).toMatchObject({ id: first.id, alreadyConverted: true });
    expect((await db.owner`select count(*)::int as n from document where doc_type = 'tax_invoice' and status = 'draft' and id = ${first.id}`)[0]!.n).toBe(1);
    // the invoice can be issued like any other
    expect((await issueDocument(db.web, owner, first.id)).document.number).toMatch(/^INV\//);
    // an answer cannot change once invoiced
    expect((await fails(decideEstimate(db.web, owner, id, 'declined'))).message).toMatch(/already been turned into an invoice/);
  });

  it('carries quotation details into the invoice without reusing quotation validity', async () => {
    const id = await issuedEstimate({ reference: 'PO-402', subject: 'Website refresh', salesperson: 'Asha',
      extra: [{ label: 'Project', value: 'WEB-26' }], paymentTerms: 'net30', dueDate: addDays(today(), 7) });
    const made = await convertEstimate(db.web, owner, id);
    const invoice = (await getDocument(db.web, owner, made.id))!.document;
    expect(invoice).toMatchObject({ reference: 'PO-402', subject: 'Website refresh', salesperson: 'Asha',
      extra: [{ label: 'Project', value: 'WEB-26' }], payment_terms: 'net30' });
    expect(String(invoice.due_date).slice(0, 10)).toBe(addDays(today(), 30));
    expect((await getDocument(db.web, owner, id))!.document.reference).toBe('PO-402');
  });

  it('can be converted again if the draft invoice is deleted', async () => {
    const id = await issuedEstimate();
    const a = await convertEstimate(db.web, owner, id);
    await deleteDraft(db.web, owner, a.id);
    expect((await getDocument(db.web, owner, id))!.estimate).toMatchObject({ status: 'accepted', converted_to_id: null });
    const b = await convertEstimate(db.web, owner, id);
    expect(b.alreadyConverted).toBe(false);
    expect(b.id).not.toBe(a.id);
  });

  it('expires at the end of its valid-until date and then refuses to be accepted or converted', async () => {
    const id = await issuedEstimate({ dueDate: addDays(today(), -1) });
    expect((await getDocument(db.web, owner, id))!.estimate).toMatchObject({ status: 'expired' });
    expect((await fails(decideEstimate(db.web, owner, id, 'accepted'))).message).toMatch(/expired/);
    expect((await fails(convertEstimate(db.web, owner, id))).message).toMatch(/expired/);
    const ok = await issuedEstimate({ dueDate: today() });                   // valid through today
    expect((await getDocument(db.web, owner, ok))!.estimate).toMatchObject({ status: 'open' });
  });

  it('is refused for a draft, a declined estimate, a non-estimate, and an accountant', async () => {
    const { id: draft } = await saveDraft(db.web, owner, estimate());
    expect((await fails(convertEstimate(db.web, owner, draft))).message).toMatch(/Issue the estimate/);
    const declined = await issuedEstimate();
    await decideEstimate(db.web, owner, declined, 'declined');
    expect((await fails(convertEstimate(db.web, owner, declined))).message).toMatch(/declined/);
    const { id: inv } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()] });
    await issueDocument(db.web, owner, inv);
    expect(await fails(decideEstimate(db.web, owner, inv, 'accepted'))).toBeInstanceOf(ValidationError);
    const open = await issuedEstimate();
    expect(await fails(decideEstimate(db.web, accountant, open, 'accepted'))).toBeInstanceOf(ForbiddenError);
    expect(await fails(convertEstimate(db.web, accountant, open))).toBeInstanceOf(ForbiddenError);
  });
});

describe('recurring invoices', () => {
  it('creates an invoice for each date that has come, once, and moves on', async () => {
    const id = (await createRecurring(db.web, owner, recurring())).id;
    const r1 = await processDueRecurring(db.web);
    expect(r1).toEqual({ created: 3, failed: 0 });                           // 14 and 7 days ago, and today
    const got = await getRecurring(db.web, owner, id);
    expect(got!.runs.map((r) => r.run_date).sort()).toEqual([addDays(today(), -14), addDays(today(), -7), today()]);
    expect(got!.runs.every((r) => r.status === 'created' && r.number)).toBe(true);
    expect(got!.profile.next_run_date).toBe(addDays(today(), 7));
    const docs = await db.owner`select d.doc_date, d.status, d.party_id from document d join recurring_run r on r.document_id = d.id where r.profile_id = ${id} order by d.doc_date`;
    expect(docs.map((d) => d.doc_date)).toEqual([addDays(today(), -14), addDays(today(), -7), today()]);
    expect(docs.every((d) => d.status === 'issued' && d.party_id === buyer)).toBe(true);
    // nothing more is due, and a second tick makes nothing
    expect(await processDueRecurring(db.web)).toEqual({ created: 0, failed: 0 });
    await deleteRecurring(db.web, owner, id);
  });

  it('two workers ticking at once still make exactly one invoice per date', async () => {
    const id = (await createRecurring(db.web, owner, recurring({ name: 'Race', startDate: today() }))).id;
    const [a, b] = await Promise.all([processDueRecurring(db.web), processDueRecurring(db.web)]);
    expect(a.created + b.created).toBe(1);
    expect((await db.owner`select count(*)::int as n from recurring_run where profile_id = ${id}`)[0]!.n).toBe(1);
    await deleteRecurring(db.web, owner, id);
  });

  it('draft mode leaves drafts, and the due date follows the payment terms', async () => {
    const id = (await createRecurring(db.web, owner, recurring({ name: 'Drafts', startDate: today(), mode: 'draft', termsDays: 15 }))).id;
    await processDueRecurring(db.web);
    const [d] = await db.owner`select d.status, d.due_date, d.number from document d join recurring_run r on r.document_id = d.id where r.profile_id = ${id}`;
    expect(d).toMatchObject({ status: 'draft', due_date: addDays(today(), 15), number: null });
    await deleteRecurring(db.web, owner, id);
  });

  it('issue and send queues one message, or says why it could not', async () => {
    const ok = (await createRecurring(db.web, owner, recurring({ name: 'Send', startDate: today(), mode: 'issue_and_send', channel: 'whatsapp' }))).id;
    const noPhone = (await createRecurring(db.web, owner, recurring({ name: 'No phone', partyId: buyerNoPhone, startDate: today(), mode: 'issue_and_send', channel: 'whatsapp' }))).id;
    await processDueRecurring(db.web);
    const sent = await db.owner`select d.channel, d.to_address, d.status from delivery d join recurring_run r on r.document_id = d.document_id where r.profile_id = ${ok}`;
    expect(sent).toEqual([{ channel: 'whatsapp', to_address: expect.stringContaining('9876543210'), status: 'queued' }]);
    expect((await db.owner`select count(*)::int as n from job where queue = 'delivery.send' and payload->>'documentId' in (select document_id::text from recurring_run where profile_id = ${ok})`)[0]!.n).toBe(1);
    const run = (await getRecurring(db.web, owner, noPhone))!.runs[0]!;
    expect(run).toMatchObject({ status: 'created', document_status: 'issued' });
    expect(run.note).toMatch(/no contact/);
    await deleteRecurring(db.web, owner, ok); await deleteRecurring(db.web, owner, noPhone);
  });

  it('one failing schedule is recorded and does not stop another', async () => {
    const bad = (await createRecurring(db.web, owner, recurring({ name: 'Will break', startDate: today() }))).id;
    const good = (await createRecurring(db.web, owner, recurring({ name: 'Fine', startDate: today() }))).id;
    await db.owner`update recurring_profile set payload = jsonb_set(payload, '{lines,0,hsnSac}', '"12"') where id = ${bad}`;   // too short for a tax invoice
    await db.owner`update business set turnover_band = 'over_5cr' where id = ${owner.businessId}`;
    try {
      expect(await processDueRecurring(db.web)).toEqual({ created: 1, failed: 1 });
    } finally { await db.owner`update business set turnover_band = 'under_5cr' where id = ${owner.businessId}`; }
    const r = (await getRecurring(db.web, owner, bad))!;
    expect(r.runs[0]).toMatchObject({ status: 'failed', document_id: null });
    expect(r.runs[0]!.note).toMatch(/HSN/);
    expect(r.profile.next_run_date).toBe(addDays(today(), 7));              // it moved on, so it will not fail again every tick
    expect((await getRecurring(db.web, owner, good))!.runs[0]).toMatchObject({ status: 'created' });
    await deleteRecurring(db.web, owner, bad); await deleteRecurring(db.web, owner, good);
  });

  it('stops after its end date, and pausing then resuming does not backfill', async () => {
    const ended = (await createRecurring(db.web, owner, recurring({ name: 'Ends', startDate: addDays(today(), -14), endDate: addDays(today(), -7) }))).id;
    expect(await processDueRecurring(db.web)).toEqual({ created: 2, failed: 0 });
    expect((await getRecurring(db.web, owner, ended))!.profile.active).toBe(false);

    const p = (await createRecurring(db.web, owner, recurring({ name: 'Paused', startDate: addDays(today(), -21), mode: 'draft' }))).id;
    await setRecurringActive(db.web, owner, p, false);
    expect(await processDueRecurring(db.web)).toEqual({ created: 0, failed: 0 });
    const resumed = await setRecurringActive(db.web, owner, p, true);
    expect(resumed.nextRunDate).toBe(today());                                // today is a scheduled date (21 days is 3 weeks)
    expect(await processDueRecurring(db.web)).toEqual({ created: 1, failed: 0 });
    await deleteRecurring(db.web, owner, ended); await deleteRecurring(db.web, owner, p);
  });

  it('refuses a template that would not make a valid invoice, and an accountant', async () => {
    expect(await fails(createRecurring(db.web, owner, recurring({ lines: [line({ rate: 'abc' })] })))).toBeInstanceOf(ValidationError);
    expect(await fails(createRecurring(db.web, owner, recurring({ mode: 'issue_and_send' })))).toBeInstanceOf(ValidationError);   // no channel
    expect(await fails(createRecurring(db.web, owner, recurring({ endDate: addDays(today(), -30) })))).toBeInstanceOf(ValidationError);
    expect(await fails(createRecurring(db.web, accountant, recurring()))).toBeInstanceOf(ForbiddenError);
    expect((await listRecurring(db.web, accountant)).length).toBeGreaterThanOrEqual(0);   // reading is allowed
  });

  it('editing changes what later runs invoice, not the schedule', async () => {
    const id = (await createRecurring(db.web, owner, recurring({ name: 'Editable', startDate: addDays(today(), 3) }))).id;
    await updateRecurring(db.web, owner, id, { name: 'Edited', partyId: buyer, mode: 'draft', lines: [line({ rate: '3000.00' })] });
    const g = (await getRecurring(db.web, owner, id))!;
    expect(g.profile).toMatchObject({ name: 'Edited', mode: 'draft', every_n: 1, unit: 'week', start_date: addDays(today(), 3) });
    expect(g.profile.payload.lines[0].rate).toBe('3000.00');
    await deleteRecurring(db.web, owner, id);
  });
});
