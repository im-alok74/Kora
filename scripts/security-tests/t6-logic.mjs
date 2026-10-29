// T6: business logic. Money, invoice states, numbering, races.
import { record, seededOwner, findings } from './lib.mjs';
const o = await seededOwner('lg');
const line = (over = {}) => ({ name: 'Svc', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service', ...over });
const draft = (lines, extra = {}) => o.post('/api/documents', { docType: 'tax_invoice', partyId: o.partyId, lines, ...extra });
const total = (r) => r.json?.document?.grand_total_paise ?? r.json?.grandTotalPaise ?? r.json?.grand_total_paise;
const show = async (id) => (await o.get(`/api/documents/${id}`)).json?.document;

// --- hostile amounts on a draft
const probes = [
  ['negative quantity', [line({ quantity: '-5' })]], ['negative rate', [line({ rate: '-1000' })]], ['zero quantity', [line({ quantity: '0' })]],
  ['quantity 10^30', [line({ quantity: '1' + '0'.repeat(30) })]], ['rate 10^30', [line({ rate: '1' + '0'.repeat(30) })]], ['rate with 12 decimals', [line({ rate: '0.000000000001' })]],
  ['tax rate 999900 bp (9999%)', [line({ taxRateBp: 999900 })]], ['tax rate -1800', [line({ taxRateBp: -1800 })]], ['tax rate not in the GST slab list (1300 bp)', [line({ taxRateBp: 1300 })]],
  ['exponent notation', [line({ rate: '1e3' })]], ['hex', [line({ rate: '0x10' })]], ['NaN', [line({ rate: 'NaN' })]], ['Infinity', [line({ rate: 'Infinity' })]],
  ['discount 200%', [line({ discountPercent: 200, discount: '200%' })]], ['discount larger than the line', [line({ discount: '5000', discountAmount: '5000' })]],
  ['10 000 lines', Array.from({ length: 10000 }, () => line())],
];
for (const [label, lines] of probes) {
  const r = await draft(lines);
  let verdict = 'HELD', ev = `${r.status} ${r.text.slice(0, 70)}`;
  if (r.status >= 200 && r.status < 300) {
    const d = await show(r.json.id); const g = BigInt(d?.grand_total_paise ?? 0);
    ev = `accepted; grand total ${g} paise`;
    verdict = g < 0n ? 'VULN' : /negative|rate 10|tax rate 999|1300|-1800|10 000|discount/.test(label) ? 'WEAK' : 'INFO';
  }
  record('T6-amount', 'logic', label, verdict, ev, verdict === 'VULN' ? 'critical' : 'medium');
}
// client-supplied totals must be ignored
{
  const r = await draft([line({ grandTotalPaise: 1, taxPaise: 0, total: 1, amountPaise: 1, taxableValuePaise: 1 })], { grandTotalPaise: 1, grand_total_paise: 1, subtotalPaise: 1, totalTax: 0 });
  const d = await show(r.json?.id);
  record('T6-trust', 'logic', 'client-supplied totals are ignored; the server computes them', String(d?.grand_total_paise) === '118000' ? 'HELD' : 'VULN', `grand total ${d?.grand_total_paise}`, 'critical');
}
// --- states
{
  const r = await draft([line()]); const id = r.json.id;
  const i1 = await o.post(`/api/documents/${id}/issue`, {}); const i2 = await o.post(`/api/documents/${id}/issue`, {});
  record('T6-issue2', 'logic', 'issuing the same invoice twice', i2.status === 200 && i1.json?.number && i2.json?.number !== i1.json?.number ? 'VULN' : 'HELD', `first ${i1.status} ${i1.json?.number ?? ''} / second ${i2.status} ${i2.text.slice(0, 60)}`, 'high');
  const edit = await o.put(`/api/documents/${id}`, { docType: 'tax_invoice', partyId: o.partyId, lines: [line({ rate: '1' })] });
  const after = await show(id);
  record('T6-edit-issued', 'logic', 'editing an issued invoice changes its amount', String(after?.grand_total_paise) !== '118000' ? 'VULN' : 'HELD', `${edit.status} ${edit.text.slice(0, 60)}; total now ${after?.grand_total_paise}`, 'critical');
  const del = await o.del(`/api/documents/${id}`);
  record('T6-delete-issued', 'logic', 'deleting an issued invoice (tax records must stay)', del.status >= 200 && del.status < 300 ? 'VULN' : 'HELD', `${del.status} ${del.text.slice(0, 60)}`, 'high');
  const c1 = await o.post(`/api/documents/${id}/cancel`, { reason: 'test' }); const c2 = await o.post(`/api/documents/${id}/cancel`, { reason: 'again' });
  record('T6-cancel2', 'logic', 'cancelling twice', c2.status === 200 ? 'WEAK' : 'HELD', `${c1.status} then ${c2.status} ${c2.text.slice(0, 60)}`, 'low');
  const pay = await o.post(`/api/documents/${id}/payments`, { amount: '100', method: 'cash', date: '2026-10-29' });
  record('T6-pay-cancelled', 'logic', 'recording a payment on a cancelled invoice', pay.status >= 200 && pay.status < 300 ? 'VULN' : 'HELD', `${pay.status} ${pay.text.slice(0, 70)}`, 'high');
}
// --- payments
{
  const r = await draft([line()]); const id = r.json.id; await o.post(`/api/documents/${id}/issue`, {});
  const tries = [['negative payment', '-500'], ['zero payment', '0'], ['payment 10x the invoice', '11800'], ['payment 10^30', '1' + '0'.repeat(30)], ['fractional paise', '0.001'], ['exponent', '1e3']];
  for (const [label, amount] of tries) {
    const p = await o.post(`/api/documents/${id}/payments`, { amount, method: 'cash', date: '2026-10-29' });
    const d = await show(id);
    const ok = p.status >= 200 && p.status < 300;
    record('T6-pay', 'logic', label, ok && (label.startsWith('negative') || label.startsWith('zero') || label.includes('10x') || label.includes('10^30')) ? 'VULN' : ok ? 'INFO' : 'HELD', `${p.status} ${p.text.slice(0, 70)}`, ok ? 'high' : '');
  }
  const d = await show(id);
  console.log('  invoice after payment probes:', JSON.stringify({ status: d?.status, paid: d?.paid_paise ?? d?.amount_paid_paise, total: d?.grand_total_paise }));
}
// --- races
{
  const ids = []; for (let i = 0; i < 12; i++) ids.push((await draft([line({ rate: String(100 + i) })])).json.id);
  const res = await Promise.all(ids.map((id) => o.post(`/api/documents/${id}/issue`, {})));
  const nums = res.map((r) => r.json?.number).filter(Boolean);
  const dup = nums.length !== new Set(nums).size;
  const seq = nums.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
  const gaps = seq.some((n, i) => i && n !== seq[i - 1] + 1);
  record('T6-race-number', 'logic', `12 invoices issued at the same moment: numbers unique and gap-free`, dup ? 'VULN' : gaps ? 'WEAK' : 'HELD', `statuses ${[...new Set(res.map((r) => r.status))]}; numbers ${seq.join(',')}`, 'high');
}
{
  const r = await draft([line()]); const id = r.json.id; await o.post(`/api/documents/${id}/issue`, {});
  const res = await Promise.all(Array.from({ length: 8 }, () => o.post(`/api/documents/${id}/payments`, { amount: '118', method: 'cash', date: '2026-10-29' })));
  const d = await show(id); const paid = BigInt(d?.paid_paise ?? d?.amount_paid_paise ?? 0);
  record('T6-race-pay', 'logic', '8 simultaneous payments of the whole amount: invoice is not overpaid', paid > 118000n ? 'VULN' : 'HELD', `accepted ${res.filter((x) => x.status === 200).length}, paid ${paid} paise of 118000`, 'high');
}
{
  const r = await draft([line()]); const id = r.json.id; await o.post(`/api/documents/${id}/issue`, {});
  const p = await o.post(`/api/documents/${id}/payments`, { amount: '1180', method: 'cash', date: '2026-10-29' });
  const pid = p.json?.id ?? p.json?.paymentId;
  const res = await Promise.all(Array.from({ length: 6 }, () => o.post(`/api/payments/${pid}/refund`, { amount: '1180' })));
  const ok = res.filter((x) => x.status === 200).length;
  record('T6-race-refund', 'logic', '6 simultaneous refunds of one payment: it can be refunded only once', ok > 1 ? 'VULN' : 'HELD', `${ok} refunds accepted (${res.map((x) => x.status).join(',')})`, 'critical');
}
