import { record, seededOwner, newUser, findings } from './lib.mjs';
const owner = await seededOwner('ro'); const staff = await newUser('st'); const acct = await newUser('ac');
await owner.post('/api/team', { identifier: staff.email, role: 'staff' }); await owner.post('/api/team', { identifier: acct.email, role: 'accountant' });
staff.headers['x-business-id'] = owner.businessId; acct.headers['x-business-id'] = owner.businessId;
const ownerId = owner.me.userId;
const att = [
  ['staff promotes self to owner (PUT /api/team/<self>)', staff, 'put', `/api/team/${staff.me.userId}`, { role: 'owner' }],
  ['staff removes the owner (DELETE /api/team/<owner>)', staff, 'del', `/api/team/${ownerId}`],
  ['staff creates a write API key', staff, 'post', '/api/keys', { name: 'steal', scope: 'write' }],
  ['accountant creates a write API key', acct, 'post', '/api/keys', { name: 'steal', scope: 'write' }],
  ['staff renames the business (PUT /api/business)', staff, 'put', '/api/business', { legalName: 'Staff Renamed' }],
  ['accountant renames the business', acct, 'put', '/api/business', { legalName: 'Acct Renamed' }],
  ['staff changes the plan (POST /api/billing)', staff, 'post', '/api/billing', { plan: 'business' }],
  ['staff creates an outbound webhook (data exfiltration channel)', staff, 'post', '/api/outbound-webhooks', { url: 'https://example.com/x', events: ['invoice.issued'] }],
  ['accountant imports data', acct, 'post', '/api/data/import', { kind: 'customers', csv: 'name\nX' }],
  ['staff cancels an issued invoice', staff, 'post', `/api/documents/${owner.docId}/cancel`, { reason: 'x' }],
  ['staff adds a late fee to an invoice', staff, 'post', `/api/documents/${owner.docId}/late-fee`, {}],
];
for (const [label, who, m, path, body] of att) {
  const r = await who[m](path, body ?? undefined);
  const allowed = r.status >= 200 && r.status < 300;
  record('T3b-role', 'roles', label, allowed ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 80)}`, 'high');
}
const still = await owner.get('/api/team');
record('T3b-owner-intact', 'roles', 'owner still owner after the attempts', JSON.stringify(still.json).includes(ownerId) ? 'HELD' : 'VULN', '');
