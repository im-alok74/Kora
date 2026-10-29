// T2b: the "ok" answers above may be no-ops. Prove it: B tries to change/delete A's data, then A checks the data is untouched.
import { record, seededOwner, uniq } from './lib.mjs';
const a = await seededOwner('A2'); const b = await seededOwner('B2');
const item = (await a.post('/api/items', { name: 'WidgetA', hsnSac: '9983', unit: 'pcs', rate: '100', defaultRateBp: 1800, kind: 'goods' })).json?.id;
const matter = (await a.post('/api/matters', { title: 'MatterA', partyId: a.partyId })).json?.id;
const exp = (await a.post('/api/expenses', { date: '2026-10-01', amount: '500', category: 'Travel', note: 'keepme' })).json?.id;
console.log('seeded', { item, matter, exp, party: a.partyId });
const before = { party: (await a.get(`/api/parties/${a.partyId}`)).status, item: (await a.get(`/api/items/${item}`)).status, matter: (await a.get(`/api/matters/${matter}`)).json?.title };
await b.del(`/api/parties/${a.partyId}`); await b.del(`/api/items/${item}`); await b.patch(`/api/matters/${matter}`, { title: 'HACKED' });
await b.del(`/api/parties/${a.partyId}/portal`); await b.del(`/api/documents/${a.docId}/share`); await b.del(`/api/expenses/${exp}/receipt`);
await b.patch(`/api/parties/${a.partyId}`, { name: 'HACKED PARTY' }); await b.post(`/api/documents/${a.docId}/cancel`, { reason: 'x' });
await b.post(`/api/documents/${a.docId}/payments`, { amount: '100', method: 'cash', date: '2026-10-29' });
const after = { party: await a.get(`/api/parties/${a.partyId}`), item: await a.get('/api/items'), matter: await a.get(`/api/matters/${matter}`), doc: await a.get(`/api/documents/${a.docId}`) };
record('T2b-party', 'tenant', 'B cannot delete/rename A\'s customer', after.party.status === 200 && !/HACKED/.test(after.party.text) ? 'HELD' : 'VULN', `after: ${after.party.status}`, 'critical');
record('T2b-item', 'tenant', 'B cannot delete A\'s item', after.item.text.includes(item) ? 'HELD' : 'VULN', `still listed: ${after.item.text.includes(item)}`, 'critical');
record('T2b-matter', 'tenant', 'B cannot edit A\'s matter', /HACKED/.test(after.matter.text) ? 'VULN' : 'HELD', `title: ${after.matter.json?.title ?? after.matter.status}`, 'critical');
record('T2b-doc', 'tenant', 'B cannot cancel A\'s invoice or add a payment', after.doc.json?.document?.status === 'issued' || /"status":"issued"/.test(after.doc.text) ? 'HELD' : 'VULN', after.doc.text.slice(0, 100), 'critical');
