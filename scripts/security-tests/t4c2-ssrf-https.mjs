// T4c: server-side request forgery through webhooks, CSRF, host header poisoning, method tricks.
import { Client, record, seededOwner, findings } from './lib.mjs';
const o = await seededOwner('ss');
const urls = ['https://127.0.0.1:3320/api/health', 'https://localhost:3320/', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]:3320/', 'https://0x7f000001/', 'https://2130706433/', 'https://127.1/', 'https://10.0.0.1/', 'https://192.168.1.1/', 'https://[::ffff:127.0.0.1]/', 'https://[fd00::1]/', 'https://127.0.0.1.nip.io/', 'https://localtest.me/', 'https://metadata.google.internal/', 'https://example.com:3320/'];
for (const url of urls) {
  const r = await o.post('/api/outbound-webhooks', { url, events: ['document.issued'] });
  if (r.status >= 200 && r.status < 300) {
    // Created. Does the test button actually connect?
    const t = await o.post(`/api/outbound-webhooks/${r.json?.id}/test`, {}); console.log('   test body:', t.text.slice(0, 160));
    const connected = /"ok":true|"status":2|200/.test(t.text) && !/not on the public|blocked/i.test(t.text);
    record('T4c-ssrf', 'ssrf', `webhook to ${url}`, connected ? 'VULN' : 'WEAK', `created (${r.status}); test call: ${t.status} ${t.text.slice(0, 110)}`, connected ? 'critical' : 'low');
  } else record('T4c-ssrf', 'ssrf', `webhook to ${url}`, 'HELD', `${r.status} ${r.text.slice(0, 90)}`);
}
