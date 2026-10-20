import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpGsp, EWAY_THRESHOLD_PAISE, ewayDateToIso, ewayUnit, ewayValidityDays, startMockGsp, validateEwayPayload, VEHICLE_NUMBER, type EwayPayload } from '@kora/adapters';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, cancelEwayBill, createBusiness, createEwayBill, createParty, ewayAdvice, ewayOverview, ewayPortalJson, issueDocument, resolveTenant, saveDraft, updateBusinessProfile,
  type TenantSession,
} from '../src/index.js';

const g = (state: string, mid: string) => { const b = `${state}${mid}1Z`; return b + gstinCheckChar(b); };
const FROM = '27AAPFU0939F1ZV';
const TO_KA = g('29', 'AABCK1234F');

const goodPayload = (over: Partial<EwayPayload> = {}): EwayPayload => ({
  supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: 'INV/26-27/0001', docDate: '20/10/2026',
  fromGstin: FROM, fromTrdName: 'Acme', fromAddr1: '1 Main Road', fromPlace: 'Pune', fromPincode: 411001, fromStateCode: 27, actFromStateCode: 27,
  toGstin: TO_KA, toTrdName: 'Buyer', toAddr1: '5 Lane', toPlace: 'Bengaluru', toPincode: 560001, toStateCode: 29, actToStateCode: 29,
  transactionType: 1, totalValue: 60000, cgstValue: 0, sgstValue: 0, igstValue: 10800, cessValue: 0, totInvValue: 70800, transMode: '1', transDistance: '840', vehicleNo: 'MH12AB1234', vehicleType: 'R',
  itemList: [{ productName: 'Steel', hsnCode: 7214, quantity: 10, qtyUnit: 'KGS', taxableAmount: 60000, sgstRate: 0, cgstRate: 0, igstRate: 18, cessRate: 0 }], ...over,
});

describe('the e-way bill rules', () => {
  it('accepts a good bill and gives the validity a regular consignment gets', () => {
    expect(validateEwayPayload(goodPayload())).toEqual([]);
    expect(ewayValidityDays(1)).toBe(1); expect(ewayValidityDays(200)).toBe(1); expect(ewayValidityDays(201)).toBe(2); expect(ewayValidityDays(840)).toBe(5);
    expect(EWAY_THRESHOLD_PAISE).toBe(5_000_000n);
  });
  it('says what is wrong, in words a person can act on', () => {
    const msg = (over: Partial<EwayPayload>) => validateEwayPayload(goodPayload(over)).map((p) => p.message).join(' | ');
    expect(msg({ fromPincode: 41100 })).toMatch(/pincode of the sender \(you\) must be 6 digits/);
    expect(msg({ toGstin: '29AAAAA0000A1Z5' })).toMatch(/GSTIN of the buyer is not valid/);
    expect(msg({ toGstin: 'URP' })).toBe('');                                                        // a customer with no GSTIN
    expect(msg({ transDistance: '0' })).toMatch(/distance must be a whole number/);
    expect(msg({ transDistance: '5000' })).toMatch(/1 to 4000/);
    expect(msg({ vehicleNo: 'MH 12 AB', transporterId: undefined })).toMatch(/vehicle number looks wrong/);
    expect(msg({ vehicleNo: undefined, transporterId: undefined })).toMatch(/vehicle number, or a transporter ID/);
    expect(msg({ vehicleNo: undefined, transporterId: FROM })).toBe('');                              // Part B can wait for the transporter
    expect(msg({ transporterId: '123' })).toMatch(/transporter ID is a GSTIN/);
    expect(msg({ itemList: [] })).toMatch(/at least one item/);
    expect(msg({ totalValue: 59999 })).toMatch(/total value does not equal/);
    expect(msg({ totInvValue: 99999 })).toMatch(/must equal the value plus the taxes/);
    expect(msg({ cgstValue: 5, sgstValue: 5 })).toMatch(/IGST and CGST or SGST cannot/);
    expect(msg({ transMode: '3', vehicleNo: undefined })).toMatch(/transport document number/);
    expect(msg({ docNo: 'bad number with spaces' })).toMatch(/1 to 16/);
    expect(msg({ itemList: [{ ...goodPayload().itemList[0]!, hsnCode: 99 }] })).toMatch(/HSN code must be 4 to 8 digits/);
  });
  it('checks vehicle numbers, units and the portal\'s date format', () => {
    for (const ok of ['MH12AB1234', 'KA01A1234', 'DL1CAB1234', 'GJ05BX9999']) expect(VEHICLE_NUMBER.test(ok), ok).toBe(true);
    for (const bad of ['MH12AB123', '12MH1234', 'MH-12-AB-1234', '']) expect(VEHICLE_NUMBER.test(bad), bad).toBe(false);
    expect(ewayUnit('kgs')).toBe('KGS'); expect(ewayUnit('widgets')).toBe('OTH'); expect(ewayUnit(null)).toBe('OTH');
    expect(ewayDateToIso('20/10/2026 12:01:00 PM')).toBe('2026-10-20T06:31:00.000Z');
    expect(ewayDateToIso('20/10/2026 12:01:00 AM')).toBe('2026-10-19T18:31:00.000Z');
    expect(ewayDateToIso('20/10/2026 11:59:00 PM')).toBe('2026-10-20T18:29:00.000Z');
  });
});

describe('making an e-way bill for an issued invoice', () => {
  let db: TestDb;
  let gspServer: Awaited<ReturnType<typeof startMockGsp>>;
  let owner: TenantSession, accountant: TenantSession;
  let ka: string, unreg: string;
  let clock = new Date('2026-10-20T06:00:00Z');
  const gsp = () => createHttpGsp({ baseUrl: gspServer.url });
  const transport = { distanceKm: 840, vehicleNo: 'MH12 AB 1234' };

  const invoice = async (party: string, lines: { name: string; hsn: string; qty?: string; rate: string; kind?: 'goods' | 'service' }[], docType: 'tax_invoice' | 'bill_of_supply' = 'tax_invoice') => {
    const d = await saveDraft(db.web, owner, { docType, partyId: party, lines: lines.map((l) => ({ name: l.name, hsnSac: l.hsn, quantity: l.qty ?? '1', rate: l.rate, unit: 'KGS', taxRateBp: docType === 'tax_invoice' ? 1800 : 0, kind: l.kind ?? 'goods' })) });
    await issueDocument(db.web, owner, d.id);
    return d.id;
  };

  beforeAll(async () => {
    gspServer = await startMockGsp(0, { now: () => clock });
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [o, a] = [await mk('o@e.test'), await mk('a@e.test')];
    const bid = await createBusiness(db.web, o, { legalName: 'Acme Steel', gstin: FROM, stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, o, bid, a, 'accountant');
    owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
    await updateBusinessProfile(db.web, owner, { legalName: 'Acme Steel', gstin: FROM, address: { line1: '1 Main Road', city: 'Pune', pincode: '411001' } });
    ka = await createParty(db.web, owner, { kind: 'customer', name: 'Bengaluru Builders', gstin: TO_KA, stateCode: '29', billingAddress: { line1: '5 Lane', city: 'Bengaluru', pincode: '560001' } });
    unreg = await createParty(db.web, owner, { kind: 'customer', name: 'Walk Buyer', stateCode: '27', billingAddress: { line1: '9 Street', city: 'Pune', pincode: '411002' } });
  }, 60_000);
  afterAll(async () => { await db?.drop(); await gspServer?.close(); });

  it('says whether one is needed: goods above Rs 50,000 yes, services no, small goods optional', async () => {
    const big = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const small = await invoice(ka, [{ name: 'Nails', hsn: '7317', rate: '100' }]);
    const svc = await invoice(ka, [{ name: 'Consulting', hsn: '998313', rate: '90000', kind: 'service' }]);
    expect((await ewayOverview(db.web, owner, big)).advice).toMatchObject({ applies: true, supported: true });
    expect((await ewayOverview(db.web, owner, small)).advice).toMatchObject({ applies: false, supported: true });
    expect((await ewayOverview(db.web, owner, svc)).advice.message).toMatch(/Services do not need/);
  });
  it('builds the portal JSON from the stored figures, with CGST and SGST inside the state and IGST outside', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const o = await ewayOverview(db.web, owner, id, transport);
    expect(o.problems).toEqual([]);
    expect(o.payload).toMatchObject({ docType: 'INV', subSupplyType: 1, fromGstin: FROM, toGstin: TO_KA, fromPincode: 411001, toPincode: 560001, fromStateCode: 27, toStateCode: 29,
      totalValue: 60000, igstValue: 10800, cgstValue: 0, totInvValue: 70800, transDistance: '840', vehicleNo: 'MH12AB1234' });
    expect(o.payload!.itemList[0]).toMatchObject({ productName: 'Steel rods', hsnCode: 7214, quantity: 10, qtyUnit: 'KGS', igstRate: 18, cgstRate: 0 });
    const local = await invoice(unreg, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const l = (await ewayOverview(db.web, owner, local, transport)).payload!;
    expect(l).toMatchObject({ toGstin: 'URP', cgstValue: 5400, sgstValue: 5400, igstValue: 0 });
    expect(l.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0 });
  });
  it('leaves services out of a mixed invoice and takes only the goods\' figures', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }, { name: 'Freight', hsn: '996511', rate: '5000', kind: 'service' }]);
    const p = (await ewayOverview(db.web, owner, id, transport)).payload!;
    expect(p.itemList).toHaveLength(1);
    expect(p.totalValue).toBe(60000);
    expect(p.totInvValue).toBe(70800);
  });
  it('lists every problem with the journey and the addresses before anything is sent', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    await expect(createEwayBill(db.web, owner, gsp(), id, { distanceKm: 0, vehicleNo: 'NOPE' })).rejects.toThrow(/Fix these before the e-way bill can be made: 1\) The distance/);
    expect(gspServer.registered().length).toBe(0);
    const noPin = await createParty(db.web, owner, { kind: 'customer', name: 'No Pin Buyer', gstin: g('29', 'AABCN1234F'), stateCode: '29' });
    const id2 = await invoice(noPin, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    await expect(createEwayBill(db.web, owner, gsp(), id2, transport)).rejects.toThrow(/pincode of the buyer must be 6 digits/);
  });
  it('makes a bill through the partner, records it, validity from the distance, and refuses a second', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const r = await createEwayBill(db.web, owner, gsp(), id, transport);
    expect(r.ewbNumber).toMatch(/^\d{12}$/);
    expect(new Date(r.validUntil).getTime() - clock.getTime()).toBe(5 * 24 * 3600_000);            // 840 km is 5 days
    const o = await ewayOverview(db.web, owner, id);
    expect(o.bills).toHaveLength(1);
    expect(o.bills[0]).toMatchObject({ ewb_number: r.ewbNumber, status: 'active', vehicle_no: 'MH12AB1234', distance_km: 840, trans_mode: '1' });
    await expect(createEwayBill(db.web, owner, gsp(), id, transport)).rejects.toThrow(/already has an e-way bill/);
  });
  it('says plainly when the partner refuses, keeps a record of the failed try, and lets a retry through', async () => {
    const dead = await createParty(db.web, owner, { kind: 'customer', name: 'Inactive Buyer', gstin: g('29', 'REJEC1234F'), stateCode: '29', billingAddress: { line1: '5 Lane', city: 'Bengaluru', pincode: '560001' } });
    const id = await invoice(dead, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    await expect(createEwayBill(db.web, owner, gsp(), id, transport)).rejects.toThrow(/buyer GSTIN is not active/);
    expect((await ewayOverview(db.web, owner, id)).bills[0]).toMatchObject({ status: 'failed', ewb_number: null });
    const down = await createParty(db.web, owner, { kind: 'customer', name: 'Outage Buyer', gstin: g('29', 'DOWNX1234F'), stateCode: '29', billingAddress: { line1: '5 Lane', city: 'Bengaluru', pincode: '560001' } });
    await expect(createEwayBill(db.web, owner, gsp(), await invoice(down, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]), transport)).rejects.toThrow(/not available right now/);
  });
  it('cancels within 24 hours, not after, and lets a new bill be made once cancelled', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const made = await createEwayBill(db.web, owner, gsp(), id, transport);
    const billId = (await ewayOverview(db.web, owner, id)).bills[0]!.id as string;
    await expect(cancelEwayBill(db.web, owner, gsp(), billId, { reason: 'mistake', remark: '' })).rejects.toThrow(/Remark/);
    await expect(cancelEwayBill(db.web, owner, gsp(), billId, { reason: 'nonsense', remark: 'x' })).rejects.toThrow(/Choose why/);
    await cancelEwayBill(db.web, owner, gsp(), billId, { reason: 'mistake', remark: 'Wrong vehicle' });
    const after = (await ewayOverview(db.web, owner, id)).bills[0]!;
    expect(after).toMatchObject({ status: 'cancelled', cancel_reason: 'Wrong vehicle' });
    await expect(cancelEwayBill(db.web, owner, gsp(), billId, { reason: 'mistake', remark: 'again' })).rejects.toThrow(/Only an active/);
    expect((await createEwayBill(db.web, owner, gsp(), id, transport)).ewbNumber).not.toBe(made.ewbNumber);
    // a bill older than a day cannot be cancelled
    const second = (await ewayOverview(db.web, owner, id)).bills.find((b) => b.status === 'active')!.id as string;
    await expect(cancelEwayBill(db.web, owner, gsp(), second, { reason: 'other', remark: 'late' }, new Date(Date.now() + 25 * 3600_000))).rejects.toThrow(/within 24 hours/);
  });
  it('gives the JSON for the portal\'s own upload page, and only for a document that passes', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    const j = await ewayPortalJson(db.web, owner, id, transport);
    expect(j.version).toBe('1.0.0421');
    expect(j.billLists).toHaveLength(1);
    await expect(ewayPortalJson(db.web, owner, id, { distanceKm: 0 })).rejects.toThrow(/Fix these/);
  });
  it('is closed to an accountant who can read but not submit, and to a document that is not goods or not issued', async () => {
    const id = await invoice(ka, [{ name: 'Steel rods', hsn: '7214', qty: '10', rate: '6000' }]);
    await expect(createEwayBill(db.web, accountant, gsp(), id, transport)).rejects.toThrow();
    expect((await ewayOverview(db.web, accountant, id)).advice.applies).toBe(true);                 // reading is fine
    const draft = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: ka, lines: [{ name: 'Rods', hsnSac: '7214', quantity: '10', rate: '6000', unit: 'KGS', taxRateBp: 1800, kind: 'goods' }] })).id;
    await expect(createEwayBill(db.web, owner, gsp(), draft, transport)).rejects.toThrow(/must be issued/);
    const credit = { docType: 'estimate' as const, partyId: ka, lines: [{ name: 'Rods', hsnSac: '7214', quantity: '1', rate: '1', unit: 'KGS', taxRateBp: 1800, kind: 'goods' as const }] };
    const est = (await saveDraft(db.web, owner, credit)).id;
    expect(ewayAdvice({ doc_type: 'estimate' }, [])).toMatchObject({ supported: false });
    await expect(createEwayBill(db.web, owner, gsp(), est, transport)).rejects.toThrow(/tax invoice, a bill of supply or a delivery challan/);
  });
});
