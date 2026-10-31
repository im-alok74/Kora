// Plan limits over HTTP, against an app started with KORA_PLANS=enforce (plus the usual KORA_ALLOW_MOCKS and DEMO_FIXED_OTP for sign-in).
// A new business is on the Starter plan: 10 invoices and quotes a month, one person, no messaging, reminders or recurring invoices.
// HELD = the limit stopped it with 402; VULN = the limit let it through (or the app is not enforcing plans).
import { record, seededOwner, newUser } from './lib.mjs';

const o = await seededOwner('plan');                       // one invoice issued already
const line = [{ name: 'Service', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }];
const issue = async () => {
  const d = await o.post('/api/documents', { docType: 'tax_invoice', partyId: o.partyId, lines: line });
  return o.post(`/api/documents/${d.json.id}/issue`, {});
};
const st = [];
for (let i = 0; i < 9; i++) st.push((await issue()).status);
record('P-under', 'plans', 'invoices 2 to 10 on Starter are issued', st.every((s) => s === 200) ? 'HELD' : 'VULN', st.join(','), 'medium');
const over = await issue();
record('P-invoice-cap', 'plans', 'the 11th invoice in a month is stopped', over.status === 402 && /plan/i.test(over.text) ? 'HELD' : 'VULN', `${over.status} ${over.text.slice(0, 90)}`, 'high');

// A credit note corrects an invoice and the law needs it, so it is never limited.
const first = o.docId;
const cn = await o.post(`/api/documents/${first}/note`, { kind: 'credit_note' });
record('P-credit-note', 'plans', 'a credit note is still allowed over the cap', cn.status === 200 || cn.status === 201 ? 'HELD' : 'WEAK', `${cn.status} ${cn.text.slice(0, 80)}`, 'low');

const invite = await o.post('/api/team', { identifier: `second.${Date.now()}@pt.test`, role: 'staff' });
record('P-members', 'plans', 'a second person on Starter is stopped', invite.status === 402 ? 'HELD' : 'VULN', `${invite.status} ${invite.text.slice(0, 90)}`, 'medium');

const rec = await o.post('/api/recurring', { name: 'Monthly', partyId: o.partyId, docType: 'tax_invoice', everyN: 1, unit: 'month', startDate: '2026-12-01', lines: line });
record('P-recurring', 'plans', 'recurring invoices on Starter are stopped', rec.status === 402 ? 'HELD' : 'VULN', `${rec.status} ${rec.text.slice(0, 90)}`, 'medium');

const rem = await o.put('/api/reminders', { enabled: true, channel: 'sms', offsets: [3] });
record('P-reminders', 'plans', 'payment reminders on Starter are stopped', rem.status === 402 ? 'HELD' : 'VULN', `${rem.status} ${rem.text.slice(0, 90)}`, 'medium');

const send = await o.post(`/api/documents/${first}/send`, { channel: 'email', to: 'x@pt.test' });
record('P-send', 'plans', 'sending by email on Starter is stopped', send.status === 402 ? 'HELD' : 'VULN', `${send.status} ${send.text.slice(0, 90)}`, 'medium');

// Another business is not affected by this one's cap.
const other = await seededOwner('plan2');
record('P-isolated', 'plans', "another business's invoices are not counted in this one's cap", other.issued ? 'HELD' : 'VULN', `issued=${other.issued}`, 'high');

const bill = await o.get('/api/billing');
record('P-billing', 'plans', 'the billing page reports the plan and usage', bill.status === 200 && /starter/i.test(bill.text) ? 'HELD' : 'WEAK', `${bill.status} ${bill.text.slice(0, 120)}`, 'low');

const bad = (await import('./lib.mjs')).findings.filter((f) => f.verdict === 'VULN');
console.log(bad.length ? `\nFAILED: ${bad.length} plan limit(s) not enforced` : '\nPASSED: plan limits enforced');
process.exit(bad.length ? 1 : 0);
