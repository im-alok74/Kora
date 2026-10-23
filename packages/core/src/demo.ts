import type { Sql } from '@kora/db';
import { gstinCheckChar } from '@kora/tax';
import { createBusiness, inTenant, resolveTenant, type TenantSession } from './tenancy.js';
import { createParty } from './parties.js';
import { createItem } from './items.js';
import { issueDocument, saveDraft, type DocIn } from './documents.js';
import { recordPayment } from './payments.js';
import { saveTemplate, DEFAULT_TEMPLATE } from './template.js';
import { updateBusinessProfile } from './business.js';
import { todayIn } from './validation.js';

/**
 * "Try it with sample data": a separate business, labelled as a demo, with customers, items, invoices (some paid, one part paid,
 * one overdue, one draft) and quotes. Nothing here touches the person's real business. It is removed with removeDemoBusiness.
 */
export const DEMO_NAME = 'Sample Studio (demo data)';

/** A GSTIN with a correct check character, built from a made-up PAN. The "ZZZZZ" prefix is not a PAN any real person holds. */
export function demoGstin(state: string, digits4: string, suffix = 'Z'): string {
  const base = `${state}ZZZZZ${digits4}${suffix}1Z`;
  return base + gstinCheckChar(base);
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function findDemoBusiness(sql: Sql, userId: string): Promise<string | null> {
  const [r] = await sql`select m.business_id from my_memberships(${userId}) m where business_is_demo(m.business_id) limit 1`;
  return (r?.business_id as string | undefined) ?? null;
}

/** Makes the demo business for this person, or returns the one they already have. Safe to call twice. */
export async function createDemoBusiness(sql: Sql, userId: string): Promise<{ businessId: string; created: boolean }> {
  const existing = await findDemoBusiness(sql, userId);
  if (existing) return { businessId: existing, created: false };
  const stamp = String(Math.floor(1000 + Math.random() * 8999));
  const gstin = demoGstin('27', stamp);
  const businessId = await createBusiness(sql, userId, { legalName: DEMO_NAME, gstin, stateCode: '27', registrationType: 'regular' });
  const t: TenantSession = await resolveTenant(sql, userId, businessId);
  await inTenant(sql, t, 'settings.write', (tx) => tx`update business set is_demo = true where id = ${businessId}`);
  const today = todayIn('Asia/Kolkata');

  await updateBusinessProfile(sql, t, {
    legalName: DEMO_NAME, address: { line1: '14 Gokhale Road, Shivaji Nagar', city: 'Pune', pincode: '411005' },
    phone: '98765 43210', email: 'hello@sample-studio.example', upiVpa: 'sample@okhdfc',
    bank: { accountName: 'Sample Studio', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank, Pune' },
    turnoverBand: 'under_5cr',
  });
  await saveTemplate(sql, t, { ...DEFAULT_TEMPLATE, accent: '#106cd9', layout: 'modern' });

  const addr = (city: string, pincode: string) => ({ line1: '221 Market Road', city, pincode });
  const c = {
    mehta: await createParty(sql, t, { kind: 'customer', name: 'Mehta Textiles Pvt Ltd', gstin: demoGstin('27', '1234', 'M'), stateCode: '27', billingAddress: addr('Mumbai', '400002'), email: 'accounts@mehta.example', phone: '9988776655' }),
    sharma: await createParty(sql, t, { kind: 'customer', name: 'Sharma Electricals', gstin: demoGstin('07', '5678', 'S'), stateCode: '07', billingAddress: addr('New Delhi', '110001'), email: 'billing@sharma.example', phone: '9811122233' }),
    iyer: await createParty(sql, t, { kind: 'customer', name: 'Iyer and Co', gstin: demoGstin('29', '9012', 'I'), stateCode: '29', billingAddress: addr('Bengaluru', '560001'), email: 'office@iyer.example', phone: '9822233344' }),
    walkin: await createParty(sql, t, { kind: 'customer', name: 'Walk-in Retail', stateCode: '27', billingAddress: addr('Pune', '411001'), phone: '9900011122' }),
  };
  await createItem(sql, t, { name: 'Monthly accounts and GST support', kind: 'service', hsnSac: '998221', defaultRateBp: 1800, price: '12000' });
  await createItem(sql, t, { name: 'Consulting hour', kind: 'service', hsnSac: '998313', defaultRateBp: 1800, price: '850' });
  await createItem(sql, t, { name: 'Printed stationery set', kind: 'goods', hsnSac: '4820', defaultRateBp: 500, price: '1250' });

  const doc = (partyId: string, offset: number, due: number, name: string, hsn: string, qty: string, rate: string, bp: number, docType: DocIn['docType'] = 'tax_invoice'): DocIn =>
    ({ docType, partyId, docDate: addDays(today, offset), dueDate: addDays(today, offset + due), lines: [{ name, hsnSac: hsn, quantity: qty, rate, taxRateBp: bp } as never] });
  const issue = async (i: DocIn) => ({ id: (await issueDocument(sql, t, (await saveDraft(sql, t, i)).id)).document.id as string });
  const pay = (id: string, amount: string, method: string, offset: number) => recordPayment(sql, t, { documentId: id, amount, method, receivedOn: addDays(today, offset) });

  const a = await issue(doc(c.mehta, -45, 15, 'Monthly accounts and GST support', '998221', '1', '12000', 1800));
  await pay(a.id, '14160', 'bank_transfer', -32);
  const b = await issue(doc(c.sharma, -30, 15, 'Cabling work, 24 port patch panel', '995463', '1', '4500', 1800));
  await pay(b.id, '5310', 'upi', -22);
  const d = await issue(doc(c.iyer, -20, 15, 'Consulting hours', '998313', '10', '850', 1800));
  await pay(d.id, '5000', 'upi', -10);
  await issue(doc(c.mehta, -18, 15, 'Quarterly audit support', '998221', '1', '30000', 1800)); // overdue
  const e = await issue(doc(c.walkin, -8, 0, 'Printed stationery set', '4820', '4', '1250', 500));
  await pay(e.id, '5250', 'cash', -8);
  await issue(doc(c.sharma, -3, 15, 'Cabling work, extra points', '995463', '1', '7200', 1800));
  await saveDraft(sql, t, doc(c.iyer, 0, 15, 'Consulting hours', '998313', '6', '850', 1800)); // left as a draft
  await issue(doc(c.mehta, -2, 14, 'Website refresh, phase 2', '998313', '1', '45000', 1800, 'estimate'));
  await issue(doc(c.iyer, -1, 14, 'Annual retainer', '998221', '1', '120000', 1800, 'estimate'));
  return { businessId, created: true };
}

/** Takes the person off their demo business. Refuses anything that is not a demo business. */
export async function removeDemoBusiness(sql: Sql, userId: string, businessId: string): Promise<boolean> {
  const [r] = await sql`select remove_demo_business(${userId}, ${businessId}) as ok`;
  return r!.ok === true;
}

export async function isDemoBusiness(sql: Sql, businessId: string): Promise<boolean> {
  const [r] = await sql`select business_is_demo(${businessId}) as d`;
  return r!.d === true;
}
