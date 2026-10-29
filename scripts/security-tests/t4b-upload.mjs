// T4b: file uploads, on the signed-in attachment endpoint and the public client upload link.
import { Client, record, seededOwner, newUser, findings, uniq } from './lib.mjs';
const o = await seededOwner('up');
const b64 = (b) => Buffer.from(b).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('....')]);
const cases = [
  ['HTML pretending to be a PNG', { name: 'a.png', type: 'image/png', data: b64('<html><script>alert(1)</script></html>') }, false],
  ['HTML with a PDF content type', { name: 'a.pdf', type: 'application/pdf', data: b64('<html><script>alert(1)</script>') }, false],
  ['SVG with script', { name: 'a.svg', type: 'image/svg+xml', data: b64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') }, false],
  ['text/html declared', { name: 'a.html', type: 'text/html', data: b64('<script>alert(1)</script>') }, false],
  ['PNG magic followed by HTML (polyglot)', { name: 'p.png', type: 'image/png', data: b64(Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')])) }, 'accepted-as-png'],
  ['real small PDF', { name: 'ok.pdf', type: 'application/pdf', data: b64('%PDF-1.4 hello') }, true],
  ['path traversal in the file name', { name: '../../../etc/passwd.pdf', type: 'application/pdf', data: b64('%PDF-1.4 x') }, 'name'],
  ['CRLF header injection in the file name', { name: 'a.pdf\r\nSet-Cookie: pwned=1', type: 'application/pdf', data: b64('%PDF-1.4 x') }, 'name'],
  ['name with quotes and semicolons', { name: 'a";filename*=UTF-8\'\'evil.html;.pdf', type: 'application/pdf', data: b64('%PDF-1.4 x') }, 'name'],
  ['3 MB file (over the 2 MB limit)', { name: 'big.pdf', type: 'application/pdf', data: b64(Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(3 * 1024 * 1024)])) }, false],
  ['empty file', { name: 'e.pdf', type: 'application/pdf', data: '' }, false],
  ['not base64', { name: 'n.pdf', type: 'application/pdf', data: '!!!not base64!!!' }, false],
  ['name 10 000 characters long', { name: 'x'.repeat(10000) + '.pdf', type: 'application/pdf', data: b64('%PDF-1.4 x') }, false],
];
let ids = [];
for (const [label, body, expect] of cases) {
  const r = await o.post(`/api/documents/${o.docId}/files`, body);
  const accepted = r.status >= 200 && r.status < 300;
  if (accepted && r.json?.id) ids.push([label, r.json.id]);
  const verdict = expect === true ? (accepted ? 'HELD' : 'WEAK') : expect === false ? (accepted ? 'VULN' : 'HELD') : (accepted ? 'INFO' : 'HELD');
  record('T4b-up', 'upload', label, verdict, `${r.status} ${r.text.slice(0, 80)}`, verdict === 'VULN' ? 'high' : '');
}
// What do the stored files look like when served?
const list = await o.get(`/api/documents/${o.docId}/files`);
for (const f of list.json?.files ?? []) {
  const d = await o.req('GET', `/api/documents/${o.docId}/files/${f.id}`, { raw: true });
  const cd = d.headers.get('content-disposition') ?? ''; const ct = d.headers.get('content-type') ?? '';
  const injected = /Set-Cookie|pwned/i.test(JSON.stringify([...d.headers.entries()]));
  record('T4b-serve', 'upload', `served file "${f.name ?? f.file_name}"`, injected || /text\/html|svg/.test(ct) ? 'VULN' : /nosniff/i.test(d.headers.get('x-content-type-options') ?? '') ? 'HELD' : 'WEAK', `type=${ct} disp=${cd.slice(0, 70)}`, 'high');
}
// Quota: unlimited uploads?
let n = 0; for (let i = 0; i < 6; i++) { const r = await o.post(`/api/documents/${o.docId}/files`, { name: `q${i}.pdf`, type: 'application/pdf', data: b64('%PDF-1.4 q' + i) }); if (r.status === 200) n++; }
record('T4b-quota', 'dos', `attachments per invoice are capped (docs say 3); extra accepted: ${n}`, n > 3 ? 'WEAK' : 'HELD', `${n} more accepted after the first ones`, 'low');
// Cross-document: attach to another business's invoice
const b = await seededOwner('up2');
const x = await b.post(`/api/documents/${o.docId}/files`, { name: 'x.pdf', type: 'application/pdf', data: b64('%PDF-1.4 x') });
record('T4b-xtenant', 'upload', 'B attaches a file to A\'s invoice', x.status >= 200 && x.status < 300 && x.json?.id ? 'VULN' : 'HELD', `${x.status} ${x.text.slice(0, 60)}`, 'critical');

// Public client upload link (CA module)
const ca = new Client(); const owner = await newUser('ca'); owner.headers['x-forwarded-for'] = '10.4.4.4';
await owner.post('/api/ca/firm', { name: 'PT Firm' });
const gst = (await import('./gstin.mjs')).gstin('27', String(Math.floor(1000 + Math.random() * 8999)));
await owner.post('/api/ca/clients', { legalName: 'PT Client', registrations: [{ gstin: gst }] });
await owner.post('/api/ca/engagements/generate', { period: '2026-08' });
const eng = (await owner.get('/api/ca/engagements?period=2026-08')).json?.engagements?.[0]?.id;
await owner.post(`/api/ca/engagements/${eng}/requests`, { defaults: true });
const link = await owner.post(`/api/ca/engagements/${eng}/upload-link`, {});
const token = link.json?.url?.split('/').pop();
const page = await ca.get(`/api/ca/upload/${token}`); const item = page.json?.items?.[0]?.id;
console.log('  upload link token length', token?.length, 'items', page.json?.items?.length);
const pub = await ca.post(`/api/ca/upload/${token}`, { requestId: item, name: 'evil.html', type: 'text/html', data: b64('<script>alert(1)</script>') });
record('T4b-pub-html', 'upload', 'client link accepts an HTML file', pub.status === 200 ? 'VULN' : 'HELD', `${pub.status} ${pub.text.slice(0, 80)}`, 'high');
const pub2 = await ca.post(`/api/ca/upload/${token}`, { requestId: item, name: 'a.pdf', type: 'application/pdf', data: b64(Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(3 * 1024 * 1024)])) });
record('T4b-pub-big', 'dos', 'client link accepts a 3 MB file', pub2.status === 200 ? 'VULN' : 'HELD', `${pub2.status}`, 'medium');
// Unlimited versions from a public link: storage exhaustion
let ok = 0; for (let i = 0; i < 40; i++) { const r = await ca.post(`/api/ca/upload/${token}`, { requestId: item, name: `s${i}.pdf`, type: 'application/pdf', data: b64('%PDF-1.4 ' + i) }); if (r.status === 200) ok++; else if (r.status === 429) break; }
record('T4b-pub-flood', 'dos', `public upload link: ${ok} files accepted in a burst of 40 (storage exhaustion from one link)`, ok >= 30 ? 'WEAK' : 'HELD', `accepted ${ok}`, 'medium');
// Guessing tokens
const wrong = await ca.get(`/api/ca/upload/${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`);
record('T4b-pub-token', 'upload', 'altered upload token is refused', wrong.status === 404 ? 'HELD' : 'VULN', `${wrong.status}`, 'high');
