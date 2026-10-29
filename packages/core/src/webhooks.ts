import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isLiveDeployment, withTenant, SYSTEM_USER, type Sql, type Tx } from '@kora/db';
import { enqueue, PermanentJobError, type JobRow } from './jobs.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

/**
 * Outbound webhooks: Kora tells another system when something happens. An event is written to the outbox in the same
 * transaction as the change that caused it, so an issued invoice always has its webhook queued and a rolled-back one never does.
 * Each request is signed, retried with growing delays, and only ever sent to a public address.
 */
export const WEBHOOK_EVENTS = ['document.issued', 'document.cancelled', 'payment.received', 'estimate.accepted', 'estimate.declined'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 10_000;
const AUTO_DISABLE_AFTER = 20;

// ---------------------------------------------------------------- signing
/** "t=<unix seconds>,v1=<hex>" where v1 is HMAC-SHA256 of "<t>.<body>" with the endpoint's secret. */
export function signWebhook(secret: string, body: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

/** For the receiver: true only if the signature matches and is recent. The body must be the raw text received. */
export function verifyWebhookSignature(secret: string, header: string | null | undefined, body: string, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > toleranceSeconds) return false;
  const expect = createHmac('sha256', secret).update(`${m[1]}.${body}`).digest();
  return timingSafeEqual(expect, Buffer.from(m[2]!, 'hex'));
}

// ---------------------------------------------------------------- where requests may go
const allowPrivate = () => process.env.KORA_WEBHOOK_ALLOW_PRIVATE === '1' && !isLiveDeployment();

const privateV4 = (a: number, b: number) =>
  a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
  (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;

/** The 16 bytes of an IPv6 address in any notation (compressed, with a dotted IPv4 tail, with a zone), or null when it is not one. */
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const q = tail.slice(1).map(Number);
    if (q.some((n) => n > 255)) return null;
    s = s.slice(0, tail.index) + ((q[0]! << 8) | q[1]!).toString(16) + ':' + ((q[2]! << 8) | q[3]!).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === '' ? [] : h.split(':'));
  const head = groups(halves[0]!), rest = halves.length === 2 ? groups(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

/**
 * True for any address that is not on the public internet: loopback, private ranges, link-local (cloud metadata), CGNAT, multicast,
 * and every IPv6 form that carries one of those inside it. Node writes `[::ffff:127.0.0.1]` as `::ffff:7f00:1`, so the IPv4 inside an
 * IPv4-mapped, IPv4-compatible or 6to4 address is read from the bytes, not from the text.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) return privateV4(Number(v4[1]), Number(v4[2]));
  const b = ipv6Bytes(ip);
  if (!b) return true;                                         // not an address we can read: treat as unsafe
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255) return privateV4(b[12]!, b[13]!);   // ::ffff:a.b.c.d
  if (b.slice(0, 12).every((x) => x === 0)) return true;      // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b[2]!, b[3]!);                                              // 6to4 2002:AABB:CCDD::
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;                                      // Teredo
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;                                // NAT64
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;                               // documentation
  return (b[0]! & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) || b[0] === 0xff;                   // fc00::/7, fe80::/10, ff00::/8
}

/** Checks a URL when it is saved. A second check happens when it is used, on the address actually connected to. */
export function validateWebhookUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ValidationError('Enter a full web address, such as https://example.com/hooks/kora.', 'url'); }
  if (u.username || u.password) throw new ValidationError('Do not put a username or password in the address.', 'url');
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) throw new ValidationError('The address must start with https://.', 'url');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowPrivate()) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !isIP(host)) throw new ValidationError('That address is not on the public internet.', 'url');
    if (isIP(host) && isPrivateAddress(host)) throw new ValidationError('That address is not on the public internet.', 'url');
  }
  if (raw.length > 500) throw new ValidationError('The address is too long.', 'url');
  return u;
}

// ---------------------------------------------------------------- endpoints
export interface WebhookIn { url: string; events: string[]; description?: string | null }

function cleanEvents(events: unknown): string[] {
  const list = Array.isArray(events) ? events.map(String) : [];
  const all = list.includes('*') ? [...WEBHOOK_EVENTS] : list;
  if (all.length === 0) throw new ValidationError('Choose at least one event.', 'events');
  for (const e of all) if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) throw new ValidationError(`Unknown event: ${e}.`, 'events');
  return [...new Set(all)];
}

export async function createWebhook(sql: Sql, t: TenantSession, i: WebhookIn) {
  const url = validateWebhookUrl(String(i.url ?? '')).toString();
  const events = cleanEvents(i.events);
  const description = str(i.description, 'Description', { max: 120 });
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const id = await inTenant(sql, t, 'member.manage', async (tx) => {
    const [n] = await tx`select count(*)::int as n from webhook_endpoint`;
    if ((n!.n as number) >= 10) throw new ValidationError('A business can have at most 10 webhook addresses.');
    const [r] = await tx`insert into webhook_endpoint (business_id, url, description, events, secret, created_by) values (${t.businessId}, ${url}, ${description}, ${events}, ${secret}, ${t.userId}) returning id`;
    return r!.id as string;
  });
  return { id, secret, events };
}

export async function listWebhooks(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'member.manage', (tx) => tx`
    select e.id, e.url, e.description, e.events, e.active, e.consecutive_failures, e.created_at,
           (select max(d.created_at) from webhook_delivery d where d.endpoint_id = e.id) as last_event_at,
           (select count(*)::int from webhook_delivery d where d.endpoint_id = e.id and d.status = 'failed') as failed
      from webhook_endpoint e order by e.created_at desc`);
}

export async function updateWebhook(sql: Sql, t: TenantSession, id: string, o: { events?: string[]; active?: boolean; description?: string | null }) {
  await inTenant(sql, t, 'member.manage', async (tx) => {
    const [cur] = await tx`select id from webhook_endpoint where id = ${id} for update`;
    if (!cur) throw new ValidationError('Webhook not found.');
    if (o.events !== undefined) await tx`update webhook_endpoint set events = ${cleanEvents(o.events)} where id = ${id}`;
    if (o.description !== undefined) await tx`update webhook_endpoint set description = ${str(o.description, 'Description', { max: 120 })} where id = ${id}`;
    // Switching one back on starts the failure count again.
    if (o.active !== undefined) await tx`update webhook_endpoint set active = ${o.active === true}, consecutive_failures = 0 where id = ${id}`;
  });
}

export async function deleteWebhook(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'member.manage', async (tx) => {
    const r = await tx`delete from webhook_endpoint where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('Webhook not found.');
  });
}

export async function listWebhookDeliveries(sql: Sql, t: TenantSession, endpointId: string) {
  return inTenant(sql, t, 'member.manage', (tx) => tx`
    select id, event_id, event_type, status, attempts, response_status, error, created_at, delivered_at
      from webhook_delivery where endpoint_id = ${endpointId} order by created_at desc limit 50`);
}

// ---------------------------------------------------------------- events
/**
 * Records an event for every live endpoint that wants it, and queues the sending. Call it inside the transaction of the change.
 * `data` holds identifiers and amounts only, never personal details beyond the customer's name.
 */
export async function emitEvent(tx: Tx, businessId: string, type: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  const eps = await tx`select id from webhook_endpoint where business_id = ${businessId} and active and ${type} = any (events)`;
  if (eps.length === 0) return 0;
  const eventId = `evt_${randomUUID().replace(/-/g, '')}`;
  const payload = { id: eventId, type, created: new Date().toISOString(), data };
  for (const ep of eps) {
    const [d] = await tx`insert into webhook_delivery (business_id, endpoint_id, event_id, event_type, payload) values (${businessId}, ${ep.id}, ${eventId}, ${type}, ${tx.json(payload as never)})
                         on conflict (endpoint_id, event_id) do nothing returning id`;
    if (d) await enqueue(tx, 'webhook.deliver', { deliveryId: d.id }, { businessId, dedupeKey: `wh:${d.id}` });
  }
  return eps.length;
}

// ---------------------------------------------------------------- sending
interface Outcome { ok: boolean; status: number | null; error: string | null; blocked?: boolean }

/** One signed POST. Redirects are not followed, the answer is cut short at 64 KB, and the address actually connected to must be public. */
export function sendWebhook(url: string, body: string, secret: string, meta: { eventId: string; type: string }): Promise<Outcome> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = validateWebhookUrl(url); } catch (e) { return resolve({ ok: false, status: null, error: (e as Error).message, blocked: true }); }
    const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
    let blocked = false;
    const req = send(u, {
      method: 'POST', timeout: TIMEOUT_MS,
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'Kora-Webhooks/1',
        'kora-signature': signWebhook(secret, body), 'kora-event-id': meta.eventId, 'kora-event-type': meta.type,
      },
      // The check that matters: whatever the name resolves to, a private address is never connected to.
      lookup: (host, opts, cb) => dnsLookup(host, { ...opts, all: false }, (err, address, family) => {
        if (err) return (cb as (e: Error) => void)(err);
        const ip = String(address);
        if (!allowPrivate() && isPrivateAddress(ip)) { blocked = true; return (cb as (e: Error) => void)(new Error('That address is not on the public internet.')); }
        (cb as (e: null, a: string, f: number) => void)(null, ip, family as number);
      }),
    }, (res: IncomingMessage) => {
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) res.destroy(); });
      res.on('end', () => resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, error: res.statusCode! >= 200 && res.statusCode! < 300 ? null : `The server answered ${res.statusCode}.` }));
      res.on('error', () => resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode ?? null, error: null }));
    });
    req.on('timeout', () => { req.destroy(new Error('The server did not answer in 10 seconds.')); });
    req.on('error', (e) => resolve({ ok: false, status: null, error: e.message.slice(0, 300), blocked }));
    req.end(body);
  });
}

/** Worker side of 'webhook.deliver'. Safe to run twice: a delivery already made is left alone. */
export async function processWebhookJob(sql: Sql, job: JobRow): Promise<void> {
  if (!job.business_id) throw new PermanentJobError('Job has no business.');
  const { deliveryId } = job.payload as { deliveryId: string };
  const final = job.attempts >= job.max_attempts;
  const ctx = { businessId: job.business_id, userId: SYSTEM_USER };

  const prep = await withTenant(sql, ctx, async (tx) => {
    const [d] = await tx`select d.id, d.status, d.payload, e.url, e.secret, e.active from webhook_delivery d join webhook_endpoint e on e.id = d.endpoint_id where d.id = ${deliveryId} for update of d`;
    if (!d || d.status === 'delivered') return null;
    if (!d.active) { await tx`update webhook_delivery set status = 'failed', error = 'The address was switched off.' where id = ${deliveryId}`; return null; }
    await tx`update webhook_delivery set attempts = attempts + 1 where id = ${deliveryId}`;
    return d;
  });
  if (!prep) return;

  const body = JSON.stringify(prep.payload);
  const out = await sendWebhook(prep.url as string, body, prep.secret as string, { eventId: (prep.payload as { id: string }).id, type: (prep.payload as { type: string }).type });

  await withTenant(sql, ctx, async (tx) => {
    if (out.ok) {
      await tx`update webhook_delivery set status = 'delivered', delivered_at = now(), response_status = ${out.status}, error = null where id = ${deliveryId}`;
      await tx`update webhook_endpoint set consecutive_failures = 0 where id = (select endpoint_id from webhook_delivery where id = ${deliveryId})`;
      return;
    }
    const lastTry = final || out.blocked;
    await tx`update webhook_delivery set response_status = ${out.status}, error = ${out.error}, status = ${lastTry ? 'failed' : 'pending'} where id = ${deliveryId}`;
    if (lastTry) {
      // A dead address stops being tried once it has failed this many deliveries in a row.
      await tx`update webhook_endpoint set consecutive_failures = consecutive_failures + 1,
                      active = case when consecutive_failures + 1 >= ${AUTO_DISABLE_AFTER} then false else active end
                where id = (select endpoint_id from webhook_delivery where id = ${deliveryId})`;
    }
  });
  if (out.blocked) throw new PermanentJobError(out.error ?? 'Blocked.');
  if (!out.ok) throw new Error(out.error ?? 'The delivery failed.');
}

/** "Send a test": one signed event to one address, right now, so a person sees at once whether it works. */
export async function testWebhook(sql: Sql, t: TenantSession, id: string) {
  const ep = await inTenant(sql, t, 'member.manage', async (tx) => {
    const [e] = await tx`select url, secret from webhook_endpoint where id = ${id}`;
    if (!e) throw new ValidationError('Webhook not found.');
    return e;
  });
  const eventId = `evt_test_${randomUUID().replace(/-/g, '')}`;
  const body = JSON.stringify({ id: eventId, type: 'ping', created: new Date().toISOString(), data: { message: 'This is a test from Kora.' } });
  const out = await sendWebhook(ep.url as string, body, ep.secret as string, { eventId, type: 'ping' });
  return { ok: out.ok, status: out.status, error: out.error };
}
