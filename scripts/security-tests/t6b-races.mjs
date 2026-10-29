import { record, seededOwner, findings } from './lib.mjs';
const o = await seededOwner('rc');
const line = { name: 'Svc', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' };
const mk = async () => { const r = await o.post('/api/documents', { docType: 'tax_invoice', partyId: o.partyId, lines: [line] }); await o.post(`/api/documents/${r.json.id}/issue`, {}); return r.json.id; };
// Whole-amount payments at the same moment
{
  const id = await mk();
  const res = await Promise.all(Array.from({ length: 8 }, () => o.post(`/api/documents/${id}/payments`, { amount: '1180', method: 'cash', date: '2026-10-29' })));
  const ok = res.filter((x) => x.status === 200).length;
  const d = (await o.get(`/api/documents/${id}`)).json;
  const paid = (d?.payments ?? []).reduce((s, p) => s + BigInt(p.amount_paise ?? 0), 0n) || BigInt(d?.document?.paid_paise ?? 0);
  record('T6b-pay-race', 'logic', '8 simultaneous payments of the full invoice amount (Rs 1,180)', ok > 1 ? 'VULN' : 'HELD', `${ok} accepted; ${res.map((x) => x.status).join(',')}; paid on record ${paid} paise`, 'high');
}
// Customer advance then refund races
{
  const adv = await o.post(`/api/parties/${o.partyId}/credit`, { amount: '1000', method: 'cash', date: '2026-10-29' });
  console.log('  advance:', adv.status, adv.text.slice(0, 120));
  const pid = adv.json?.id ?? adv.json?.paymentId;
  if (pid) {
    const res = await Promise.all(Array.from({ length: 6 }, () => o.post(`/api/payments/${pid}/refund`, { amount: '1000', method: 'cash' })));
    const ok = res.filter((x) => x.status === 200).length;
    record('T6b-refund-race', 'logic', '6 simultaneous refunds of one Rs 1,000 advance', ok > 1 ? 'VULN' : 'HELD', `${ok} accepted (${res.map((x) => x.status).join(',')})`, 'critical');
  } else record('T6b-refund-race', 'logic', 'refund race (could not create an advance)', 'INFO', adv.text.slice(0, 100));
}
// Apply the same credit to two invoices at once
{
  const a = await mk(), b = await mk();
  const adv = await o.post(`/api/parties/${o.partyId}/credit`, { amount: '1180', method: 'cash', date: '2026-10-29' });
  const pid = adv.json?.id ?? adv.json?.paymentId;
  if (pid) {
    const res = await Promise.all([a, b].map((id) => o.post(`/api/documents/${id}/apply-credit`, { paymentId: pid, amount: '1180' })));
    record('T6b-credit-race', 'logic', 'one Rs 1,180 advance applied to two invoices at once', res.filter((x) => x.status === 200).length > 1 ? 'VULN' : 'HELD', res.map((x) => `${x.status} ${x.text.slice(0, 50)}`).join(' | '), 'critical');
  } else record('T6b-credit-race', 'logic', 'credit race (no advance)', 'INFO', adv.text.slice(0, 100));
}
