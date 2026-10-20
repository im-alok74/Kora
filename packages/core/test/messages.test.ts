import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpGsp, createMockMessenger } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, checkMessage, createBusiness, createHandlers, createParty, DEFAULT_MESSAGES, fillMessage, getMessageTemplates, issueDocument, queueDocumentSend, resolveTenant,
  runJobsOnce, saveDraft, saveMessageTemplates, type TenantSession,
} from '../src/index.js';

describe('writing a message', () => {
  it('accepts the known placeholders and needs the link', () => {
    expect(checkMessage('Hi {customer}, {type} {number} for {amount}: {link}', 'invoice')).toContain('{link}');
    expect(() => checkMessage('No link here', 'invoice')).toThrow(/Include \{link\}/);
    expect(() => checkMessage('Hi {name}, {link}', 'invoice')).toThrow(/\{name\} is not something Kora can fill in/);
    expect(() => checkMessage('Hi {customer, {link}', 'reminder')).toThrow(/curly bracket/);
    expect(() => checkMessage('   ', 'invoice')).toThrow(/Write the invoice message/);
    expect(() => checkMessage('x'.repeat(501) + '{link}', 'invoice')).toThrow(/at most 500/);
    expect(checkMessage('  {link}  ', 'invoice')).toBe('{link}');
  });
  it('has a default for each kind that passes its own check', () => {
    for (const k of ['invoice', 'reminder'] as const) expect(() => checkMessage(DEFAULT_MESSAGES[k], k)).not.toThrow();
  });
  it('fills placeholders, and leaves nothing odd behind for an empty one', () => {
    expect(fillMessage('Hi {customer}, {number}: {link}', { customer: 'Asha', number: 'INV/1', link: 'http://x/i/abc' })).toBe('Hi Asha, INV/1: http://x/i/abc');
    expect(fillMessage('Pay by {due_date} . Thanks {link}', { link: 'L' })).toBe('Pay by. Thanks L');
    expect(fillMessage('{link} {link}', { link: 'L' })).toBe('L L');
  });
});

describe('a business with its own wording', () => {
  let db: TestDb;
  let owner: TenantSession, staff: TenantSession, customer: string;
  const messenger = createMockMessenger();
  const drain = () => runJobsOnce(db.web, createHandlers(db.web, { messenger, appUrl: 'http://localhost:3000', gsp: createHttpGsp({ baseUrl: 'http://127.0.0.1:9' }) }), { limit: 50 });

  beforeAll(async () => {
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [o, s] = [await mk('o@m.test'), await mk('s@m.test')];
    const bid = await createBusiness(db.web, o, { legalName: 'Words Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, o, bid, s, 'staff');
    owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid);
    customer = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  const issued = async () => {
    const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, dueDate: '2026-12-01', lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 0, kind: 'service' }] });
    await issueDocument(db.web, owner, d.id);
    return d.id;
  };

  it('starts with Kora\'s wording, and only an owner can change it', async () => {
    const t = await getMessageTemplates(db.web, owner);
    expect(t).toMatchObject({ invoice: null, reminder: null });
    expect(t.defaults.invoice).toBe(DEFAULT_MESSAGES.invoice);
    await expect(saveMessageTemplates(db.web, staff, { invoice: 'Hi {link}' })).rejects.toThrow();
  });
  it('sends its own wording, with the customer and the number filled in', async () => {
    await saveMessageTemplates(db.web, owner, { invoice: 'Namaste {customer}! {type} {number} ({amount}) is ready. Open: {link}' });
    const id = await issued();
    await queueDocumentSend(db.web, owner, { documentId: id, channel: 'whatsapp', to: '9876543210' });
    await drain();
    const sent = messenger.outbox.at(-1)!;
    expect(sent.text).toMatch(/^Namaste Asha Stores! Tax invoice INV\/\S+ \(Rs 1,000\.00\) is ready\. Open: http:\/\/localhost:3000\/i\//);
  });
  it('keeps the other kind on Kora\'s wording, and uses the reminder text for a reminder', async () => {
    const t = await saveMessageTemplates(db.web, owner, { reminder: 'Friendly nudge from {business}: {outstanding} due on {due_date}. {link}' });
    expect(t.invoice).toContain('Namaste');                                              // left alone when not mentioned
    const id = await issued();
    const [r] = await db.owner`insert into reminder (business_id, document_id, channel, scheduled_at) values (${owner.businessId}, ${id}, 'whatsapp', now()) returning id`;
    await queueDocumentSend(db.web, owner, { documentId: id, channel: 'whatsapp', to: '9876543210', reminderId: r!.id as string });
    await drain();
    expect(messenger.outbox.at(-1)!.text).toMatch(/^Friendly nudge from Words Co: Rs 1,000\.00 due on 2026-12-01\. http/);
  });
  it('goes back to Kora\'s wording when cleared, and refuses a bad message without changing anything', async () => {
    await expect(saveMessageTemplates(db.web, owner, { invoice: 'No link' })).rejects.toThrow(/Include \{link\}/);
    expect((await getMessageTemplates(db.web, owner)).invoice).toContain('Namaste');
    const t = await saveMessageTemplates(db.web, owner, { invoice: '', reminder: null });
    expect(t).toMatchObject({ invoice: null, reminder: null });
    expect((await db.owner`select message_templates from business where id = ${owner.businessId}`)[0]!.message_templates).toBeNull();
    const id = await issued();
    await queueDocumentSend(db.web, owner, { documentId: id, channel: 'sms', to: '9876543210' });
    await drain();
    expect(messenger.outbox.at(-1)!.text).toMatch(/^Tax invoice INV\/\S+ for Rs 1,000\.00 from Words Co\. View and download: /);
  });
});

describe('choosing a look', () => {
  it('accepts the new looks and still refuses an unknown one', async () => {
    const { sanitiseTemplate } = await import('../src/index.js');
    expect(sanitiseTemplate({ layout: 'modern' }).layout).toBe('modern');
    expect(sanitiseTemplate({ layout: 'minimal' }).layout).toBe('minimal');
    expect(() => sanitiseTemplate({ layout: 'fancy' })).toThrow(/Choose a layout/);
  });
});
