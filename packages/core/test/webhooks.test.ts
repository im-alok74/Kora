import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, cancelDocument, createBusiness, createParty, createWebhook, decideEstimate, deleteWebhook, emitEvent, isPrivateAddress, issueDocument, listWebhookDeliveries,
  listWebhooks, processWebhookJob, recordPayment, resolveTenant, runJobsOnce, saveDraft, signWebhook, testWebhook, updateWebhook, validateWebhookUrl, verifyWebhookSignature,
  ForbiddenError, ValidationError, type TenantSession,
} from '../src/index.js';

describe('signatures', () => {
  const secret = 'whsec_test_secret_test_secret_test_secret';
  const body = '{"id":"evt_1","type":"document.issued"}';
  it('verify for the right secret and body, and nothing else', () => {
    const now = 1_800_000_000;
    const h = signWebhook(secret, body, now);
    expect(h).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, h, body, 300, now)).toBe(true);
    expect(verifyWebhookSignature(secret + 'x', h, body, 300, now)).toBe(false);          // wrong secret
    expect(verifyWebhookSignature(secret, h, body + ' ', 300, now)).toBe(false);          // body changed
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now - 301), body, 300, now)).toBe(false);   // too old: a replay
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now + 301), body, 300, now)).toBe(false);   // too far ahead
    expect(verifyWebhookSignature(secret, h.replace('t=1800000000', 't=1800000001'), body, 300, now)).toBe(false);   // time swapped in
    for (const bad of [null, undefined, '', 't=1,v1=2', 'v1=' + 'a'.repeat(64), `t=${now},v1=${'A'.repeat(64)}`, `t=${now},v1=${'a'.repeat(63)}`]) {
      expect(verifyWebhookSignature(secret, bad as never, body, 300, now)).toBe(false);
    }
  });
});

describe('where webhooks may go', () => {
  it('refuses every address that is not on the public internet', () => {
    for (const ip of ['127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
                      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::5', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '203.0.113.5', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it('accepts a normal https address and refuses the rest when saved', () => {
    expect(validateWebhookUrl('https://hooks.example.com/kora?x=1').hostname).toBe('hooks.example.com');
    for (const bad of ['http://example.com/x', 'ftp://example.com', 'not a url', '', 'https://localhost/x', 'https://app.localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/x',
                       'https://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/x', 'https://printer.local/x', 'https://intranet/x', 'https://user:pw@example.com/x', 'javascript:alert(1)']) {
      expect(() => validateWebhookUrl(bad), bad).toThrow(ValidationError);
    }
    expect(() => validateWebhookUrl('https://example.com/' + 'a'.repeat(500))).toThrow(/too long/);
  });
});

describe('webhooks end to end', () => {
  let db: TestDb;
  let owner: TenantSession, staff: TenantSession;
  let buyer: string;
  let server: Server | null = null;
  let reqs: { headers: IncomingHttpHeaders; body: string; url: string }[] = [];
  let respond: (n: number) => number = () => 200;
  const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

  async function receiver() {
    reqs = []; respond = () => 200;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { reqs.push({ headers: req.headers, body, url: req.url ?? '' }); res.statusCode = respond(reqs.length); res.end('ok'); });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/hook`;
  }
  const work = () => runJobsOnce(db.web, { 'webhook.deliver': (job) => processWebhookJob(db.web, job) });
  const invoice = async (over = {}) => {
    const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000', taxRateBp: 1800 }], ...over });
    return (await issueDocument(db.web, owner, id)).document;
  };

  beforeAll(async () => {
    process.env.KORA_WEBHOOK_ALLOW_PRIVATE = '1';
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [u, s] = [await mk('o@e.test'), await mk('s@e.test')];
    const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, u, bid, s, 'staff');
    owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid);
    buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
  }, 60_000);
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null;
    process.env.KORA_WEBHOOK_ALLOW_PRIVATE = '1';
    await db.owner`delete from webhook_endpoint`; await db.owner`delete from job where queue = 'webhook.deliver'`;
  });
  afterAll(async () => { delete process.env.KORA_WEBHOOK_ALLOW_PRIVATE; await db?.drop(); });

  it('are made by the owner, show their secret once, and keep it out of lists and the activity log', async () => {
    const url = await receiver();
    const w = await createWebhook(db.web, owner, { url, events: ['document.issued', 'payment.received'], description: 'ERP' });
    expect(w.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(w.events).toEqual(['document.issued', 'payment.received']);
    const list = await listWebhooks(db.web, owner);
    expect(list[0]).toMatchObject({ id: w.id, url, description: 'ERP', active: true, consecutive_failures: 0 });
    expect(JSON.stringify(list)).not.toContain(w.secret);
    expect((await db.owner`select count(*)::int as n from audit_log where table_name = 'webhook_endpoint'`)[0]!.n).toBe(0);
    for (const t of [staff]) {
      expect(await fails(createWebhook(db.web, t, { url, events: ['*'] }))).toBeInstanceOf(ForbiddenError);
      expect(await fails(listWebhooks(db.web, t))).toBeInstanceOf(ForbiddenError);
    }
  });

  it('check the events, the address and the count', async () => {
    const url = await receiver();
    expect((await createWebhook(db.web, owner, { url, events: ['*'] })).events).toHaveLength(5);
    expect(await fails(createWebhook(db.web, owner, { url, events: [] }))).toBeInstanceOf(ValidationError);
    expect(await fails(createWebhook(db.web, owner, { url, events: ['document.deleted'] }))).toBeInstanceOf(ValidationError);
    process.env.KORA_WEBHOOK_ALLOW_PRIVATE = '';
    expect((await fails(createWebhook(db.web, owner, { url, events: ['*'] }))).message).toMatch(/https|public internet/);
    process.env.KORA_WEBHOOK_ALLOW_PRIVATE = '1';
    for (let i = 1; i < 10; i++) await createWebhook(db.web, owner, { url, events: ['*'] });
    expect((await fails(createWebhook(db.web, owner, { url, events: ['*'] }))).message).toMatch(/at most 10/);
  });

  it('send a signed event when an invoice is issued, and again for a payment', async () => {
    const url = await receiver();
    const w = await createWebhook(db.web, owner, { url, events: ['document.issued', 'payment.received', 'document.cancelled'] });
    const inv = await invoice();
    expect((await db.owner`select count(*)::int as n from job where queue = 'webhook.deliver'`)[0]!.n).toBe(1);   // queued by the same change
    expect(reqs).toHaveLength(0);
    expect(await work()).toMatchObject({ claimed: 1, done: 1 });

    expect(reqs).toHaveLength(1);
    const r = reqs[0]!;
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['kora-event-type']).toBe('document.issued');
    expect(verifyWebhookSignature(w.secret, r.headers['kora-signature'] as string, r.body)).toBe(true);     // the receiver can check it
    const evt = JSON.parse(r.body);
    expect(evt).toMatchObject({ type: 'document.issued', data: { id: inv.id, number: inv.number, doc_type: 'tax_invoice', total_paise: '118000', party_name: 'Asha Stores' } });
    expect(r.headers['kora-event-id']).toBe(evt.id);
    expect(evt.id).toMatch(/^evt_[0-9a-f]{32}$/);

    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '500.00', method: 'upi' });
    await work();
    expect(JSON.parse(reqs[1]!.body)).toMatchObject({ type: 'payment.received', data: { document_id: inv.id, number: inv.number, amount_paise: '50000', method: 'upi', status: 'part_paid' } });

    await cancelDocument(db.web, owner, (await invoice()).id as string, 'Entered twice'); await work(); await work();
    // Within one batch the order is not guaranteed, which is why every event carries its own created time.
    expect(reqs.map((x) => x.headers['kora-event-type']).sort()).toEqual(['document.cancelled', 'document.issued', 'document.issued', 'payment.received']);
    const deliveries = await listWebhookDeliveries(db.web, owner, w.id);
    expect(deliveries.map((d) => d.status)).toEqual(['delivered', 'delivered', 'delivered', 'delivered']);
    expect(deliveries[0]).toMatchObject({ attempts: 1, response_status: 200, error: null });
  });

  it('only send the events an address asked for, and tell every address that did', async () => {
    const url = await receiver();
    await createWebhook(db.web, owner, { url, events: ['estimate.accepted'] });
    await createWebhook(db.web, owner, { url, events: ['*'] });
    const est = await invoice({ docType: 'estimate' });                                    // issued: only the second hears of it
    await work(); await work();
    expect(reqs.map((x) => x.headers['kora-event-type'])).toEqual(['document.issued']);
    await decideEstimate(db.web, owner, est.id as string, 'accepted'); await work(); await work();
    expect(reqs.map((x) => x.headers['kora-event-type']).sort()).toEqual(['document.issued', 'estimate.accepted', 'estimate.accepted']);
    expect(JSON.parse(reqs.at(-1)!.body).data).toMatchObject({ id: est.id, answered_by: 'staff' });
    await decideEstimate(db.web, owner, est.id as string, 'declined', 'portal'); await work();
    expect(reqs.some((x) => x.headers['kora-event-type'] === 'estimate.declined' && JSON.parse(x.body).data.answered_by === 'portal')).toBe(true);
  });

  it('are never sent for a change that was rolled back', async () => {
    const url = await receiver();
    await createWebhook(db.web, owner, { url, events: ['*'] });
    await db.web.begin(async (tx) => {
      await tx`select set_config('app.business_id', ${owner.businessId}, true)`; await tx`select set_config('app.user_id', ${owner.userId}, true)`;
      await emitEvent(tx, owner.businessId, 'document.issued', { id: 'x' });
      throw new Error('rolled back');
    }).catch(() => {});
    expect((await db.owner`select count(*)::int as n from webhook_delivery`)[0]!.n).toBe(0);
    expect((await db.owner`select count(*)::int as n from job where queue = 'webhook.deliver'`)[0]!.n).toBe(0);
  });

  it('retry after a failure, and stop retrying once delivered', async () => {
    const url = await receiver();
    respond = (n) => (n === 1 ? 500 : 200);
    const w = await createWebhook(db.web, owner, { url, events: ['document.issued'] });
    await invoice();
    expect(await work()).toMatchObject({ claimed: 1, retried: 1 });
    let [d] = await listWebhookDeliveries(db.web, owner, w.id);
    expect(d).toMatchObject({ status: 'pending', attempts: 1, response_status: 500, error: 'The server answered 500.' });
    expect(await work()).toMatchObject({ claimed: 0 });                                    // waits out its delay
    await db.owner`update job set run_at = now() where queue = 'webhook.deliver'`;
    expect(await work()).toMatchObject({ claimed: 1, done: 1 });
    [d] = await listWebhookDeliveries(db.web, owner, w.id);
    expect(d).toMatchObject({ status: 'delivered', attempts: 2, response_status: 200, error: null });
    expect(reqs).toHaveLength(2);
    expect(JSON.parse(reqs[0]!.body).id).toBe(JSON.parse(reqs[1]!.body).id);              // the same event id, so the receiver can drop a repeat
    const job = (await db.owner`select payload from job where queue = 'webhook.deliver'`)[0]!;
    await processWebhookJob(db.web, { id: 'x', queue: 'webhook.deliver', business_id: owner.businessId, payload: job.payload as never, attempts: 1, max_attempts: 8 });
    expect(reqs).toHaveLength(2);                                                          // running it again sends nothing
  });

  it('give up after the last attempt, and switch an address off after twenty failures in a row', async () => {
    const url = await receiver();
    respond = () => 500;
    const w = await createWebhook(db.web, owner, { url, events: ['document.issued'] });
    for (let i = 0; i < 20; i++) {
      await invoice();
      await db.owner`update job set max_attempts = 1 where queue = 'webhook.deliver' and status = 'queued'`;      // so this failure is the last
      await work();
    }
    const [ep] = await listWebhooks(db.web, owner);
    expect(ep).toMatchObject({ id: w.id, active: false, consecutive_failures: 20, failed: 20 });
    const before = reqs.length;
    await invoice();                                                                       // an address that is off hears nothing, and no job is made
    expect((await db.owner`select count(*)::int as n from job where queue = 'webhook.deliver' and status = 'queued'`)[0]!.n).toBe(0);
    expect(reqs.length).toBe(before);
    await updateWebhook(db.web, owner, w.id, { active: true });
    expect((await listWebhooks(db.web, owner))[0]).toMatchObject({ active: true, consecutive_failures: 0 });
  }, 90_000);

  it('never send to a private address once the check is on, and do not retry', async () => {
    const url = await receiver();
    await createWebhook(db.web, owner, { url, events: ['document.issued'] });
    await invoice();
    process.env.KORA_WEBHOOK_ALLOW_PRIVATE = '';
    const r = await work();
    expect(r).toMatchObject({ claimed: 1, failed: 1, retried: 0 });                         // a permanent failure, not a retry
    expect(reqs).toHaveLength(0);                                                           // nothing reached the server
    const [d] = await db.owner`select status, error from webhook_delivery`;
    expect(d).toMatchObject({ status: 'failed', error: expect.stringMatching(/https|public internet/) });
  });

  it('can be tested, paused, and deleted along with their history', async () => {
    const url = await receiver();
    const w = await createWebhook(db.web, owner, { url, events: ['document.issued'] });
    expect(await testWebhook(db.web, owner, w.id)).toEqual({ ok: true, status: 200, error: null });
    expect(JSON.parse(reqs[0]!.body)).toMatchObject({ type: 'ping' });
    expect(verifyWebhookSignature(w.secret, reqs[0]!.headers['kora-signature'] as string, reqs[0]!.body)).toBe(true);
    respond = () => 503;
    expect(await testWebhook(db.web, owner, w.id)).toEqual({ ok: false, status: 503, error: 'The server answered 503.' });

    await updateWebhook(db.web, owner, w.id, { active: false });
    await invoice(); expect((await db.owner`select count(*)::int as n from webhook_delivery`)[0]!.n).toBe(0);
    await updateWebhook(db.web, owner, w.id, { active: true, events: ['payment.received'] });
    await invoice(); expect((await db.owner`select count(*)::int as n from webhook_delivery`)[0]!.n).toBe(0);   // no longer asks for issued
    await updateWebhook(db.web, owner, w.id, { events: ['document.issued'] });
    await invoice();
    await deleteWebhook(db.web, owner, w.id);
    expect((await db.owner`select count(*)::int as n from webhook_delivery`)[0]!.n).toBe(0);
    expect(await work()).toMatchObject({ claimed: 1, done: 1 });                            // the job finds nothing to send and finishes quietly
    expect(await fails(deleteWebhook(db.web, owner, w.id))).toBeInstanceOf(ValidationError);
    expect(await fails(testWebhook(db.web, owner, w.id))).toBeInstanceOf(ValidationError);
  });
});
