import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

export const MESSAGE_KINDS = ['invoice', 'reminder', 'statement'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** The placeholders a message can use, with what each becomes. The link is required: a message without it is no use to the customer. */
export const MESSAGE_FIELDS: [string, string][] = [
  ['customer', 'The customer\'s name'], ['type', 'Tax invoice, Estimate and so on'], ['number', 'The document number'], ['amount', 'The document total'],
  ['outstanding', 'What is still due'], ['due_date', 'The due date, if there is one'], ['business', 'Your business name'], ['link', 'The link to view and pay'],
  ['period', 'The dates a statement covers'],
];

/** Kora's own wording, used until a business writes its own. */
export const DEFAULT_MESSAGES: Record<MessageKind, string> = {
  invoice: '{type} {number} for {amount} from {business}. View and download: {link}',
  reminder: 'Reminder: {type} {number} from {business}, {outstanding} still due. View and pay: {link}',
  statement: 'Statement of account from {business} for {period}. {outstanding} is due as things stand. The entries are below.',
};

const NAMES = new Set(MESSAGE_FIELDS.map(([k]) => k));

/** Checks the text a person wrote. Returns it trimmed, or says in plain words what to change. */
export function checkMessage(raw: unknown, kind: MessageKind): string {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length === 0) throw new ValidationError(`Write the ${kind} message, or reset it to use Kora's wording.`, kind);
  if (text.length > 500) throw new ValidationError('A message can be at most 500 characters, so it fits an SMS or a WhatsApp message.', kind);
  const used = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!);
  const bad = used.find((u) => !NAMES.has(u));
  if (bad !== undefined) throw new ValidationError(`{${bad}} is not something Kora can fill in. Use: ${MESSAGE_FIELDS.map(([k]) => `{${k}}`).join(', ')}.`, kind);
  if (/\{|\}/.test(text.replace(/\{[a-z_]+\}/g, ''))) throw new ValidationError('A curly bracket is left open. Write a placeholder as {customer}, with a bracket on each side.', kind);
  // A statement carries its own entries in the body, so it is the one message that needs no link.
  if (kind !== 'statement' && !used.includes('link')) throw new ValidationError('Include {link}, so the customer can open the document.', kind);
  return text;
}

/** Fills the placeholders. A value that is missing becomes empty rather than leaving a bracket in the message. */
export function fillMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, k: string) => vars[k] ?? '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

export async function getMessageTemplates(sql: Sql, t: TenantSession) {
  const [b] = await inTenant(sql, t, 'document.read', (tx) => tx`select message_templates from business where id = ${t.businessId}`);
  const custom = (b?.message_templates ?? {}) as Partial<Record<MessageKind, string>>;
  return { invoice: custom.invoice ?? null, reminder: custom.reminder ?? null, statement: custom.statement ?? null, defaults: DEFAULT_MESSAGES, fields: MESSAGE_FIELDS };
}

/** A kind left out keeps what it has. An empty string or null removes the business's own wording for it, so Kora's is used. */
export async function saveMessageTemplates(sql: Sql, t: TenantSession, input: Partial<Record<MessageKind, string | null>>) {
  await inTenant(sql, t, 'settings.write', async (tx) => {
    const [b] = await tx`select message_templates from business where id = ${t.businessId} for update`;
    const next = { ...((b?.message_templates ?? {}) as Partial<Record<MessageKind, string>>) };
    for (const kind of MESSAGE_KINDS) {
      if (!(kind in input)) continue;
      const v = input[kind];
      if (v === null || String(v).trim() === '') delete next[kind];
      else next[kind] = checkMessage(v, kind);
    }
    await tx`update business set message_templates = ${Object.keys(next).length ? tx.json(next as any) : null} where id = ${t.businessId}`;
  });
  return getMessageTemplates(sql, t);
}
