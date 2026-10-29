import { withUser, type Sql } from '@kora/db';
import { ValidationError } from './validation.js';

/**
 * Digital Personal Data Protection Act, 2023: consent that can be shown and withdrawn, and a person's requests about their own
 * data. Business records (customers, invoices) belong to the business; this is about the person who signs in.
 * Bump NOTICE_VERSION when the privacy notice changes in a way that needs fresh consent; people are asked again on next sign in.
 */
export const NOTICE_VERSION = '2026-10';

export const CONSENT_PURPOSES = {
  terms_privacy: { label: 'Terms of use and privacy notice', required: true, text: 'Needed to run your Kora account.' },
  product_updates: { label: 'Product news and tips by email', required: false, text: 'Occasional updates about Kora. You can stop them at any time.' },
  messaging_notifications: { label: 'Account alerts by SMS and WhatsApp', required: false, text: 'Sign-in and payment alerts sent to your phone, beyond what is needed to sign in.' },
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;
const isPurpose = (p: string): p is ConsentPurpose => p in CONSENT_PURPOSES;

export const REQUEST_KINDS = ['access', 'correction', 'erasure', 'grievance', 'nomination'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
const MAX_OPEN_REQUESTS = 5;

/** Records one consent decision. The history is never edited: a withdrawal is a new row. */
export async function setConsent(sql: Sql, userId: string, purpose: string, given: boolean, source: string): Promise<void> {
  if (!isPurpose(purpose)) throw new ValidationError('Unknown consent.', 'purpose');
  if (purpose === 'terms_privacy' && !given) {
    throw new ValidationError('The terms and privacy notice are needed to keep an account. To withdraw, close your account from the Privacy page.', 'purpose');
  }
  await withUser(sql, userId, (tx) => tx`insert into consent_event (user_id, purpose, action, notice_version, source)
                                         values (${userId}, ${purpose}, ${given ? 'given' : 'withdrawn'}, ${NOTICE_VERSION}, ${source.slice(0, 40)})`);
}

export type ConsentState = { purpose: ConsentPurpose; label: string; text: string; required: boolean; given: boolean; since: string | null; noticeVersion: string | null; needsRenewal: boolean };

/** The current answer for each purpose: the latest decision, or "not given" when there is none. */
export async function consentStates(sql: Sql, userId: string): Promise<ConsentState[]> {
  const rows = await withUser(sql, userId, (tx) => tx`select distinct on (purpose) purpose, action, notice_version, created_at::text as at
                                                      from consent_event where user_id = ${userId} order by purpose, created_at desc, id desc`);
  const by = new Map(rows.map((r) => [r.purpose as string, r]));
  return (Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]).map((purpose) => {
    const r = by.get(purpose), given = r?.action === 'given';
    return { purpose, ...CONSENT_PURPOSES[purpose], given, since: (r?.at as string | undefined) ?? null, noticeVersion: (r?.notice_version as string | undefined) ?? null,
             needsRenewal: given && r?.notice_version !== NOTICE_VERSION };
  });
}

/** Opens a request about the person's own data. Due in 30 days; a few open at a time is plenty, more is a sign of a mistake. */
export async function openPrivacyRequest(sql: Sql, userId: string, i: { kind: string; details?: string }) {
  if (!(REQUEST_KINDS as readonly string[]).includes(i.kind)) throw new ValidationError('Choose what the request is about.', 'kind');
  const details = String(i.details ?? '').trim();
  if (details.length > 4000) throw new ValidationError('Please keep the details under 4,000 characters.', 'details');
  if ((i.kind === 'grievance' || i.kind === 'nomination' || i.kind === 'correction') && details.length < 5) throw new ValidationError('Tell us a little more so we can act on it.', 'details');
  return withUser(sql, userId, async (tx) => {
    const [n] = await tx`select count(*)::int as n from privacy_request where status in ('open', 'in_progress')`;
    if ((n!.n as number) >= MAX_OPEN_REQUESTS) throw new ValidationError('You already have several open requests. We will answer those first.');
    const [r] = await tx`insert into privacy_request (user_id, kind, details) values (${userId}, ${i.kind}, ${details}) returning id, due_at::text as due_at`;
    return { id: r!.id as string, dueAt: r!.due_at as string };
  });
}

export async function listPrivacyRequests(sql: Sql, userId: string) {
  return withUser(sql, userId, (tx) => tx`select id, kind, details, status, due_at::text as due_at, resolution, resolved_at::text as resolved_at, created_at::text as created_at
                                          from privacy_request order by created_at desc limit 50`);
}

/** Everything Kora holds about the person themselves (the right of access). Business records have their own export. */
export async function personalDataExport(sql: Sql, userId: string) {
  const [u] = await sql`select id, phone, email, display_name, account_type, created_at::text as created_at from app_user where id = ${userId}`;
  const memberships = await sql`select b.legal_name, m.role, m.created_at::text as since from member m join business b on b.id = m.business_id where m.user_id = ${userId}`;
  const sessions = await sql`select ip, user_agent, created_at::text as created_at, last_seen_at::text as last_seen_at from app_session where user_id = ${userId} order by created_at desc limit 100`;
  const events = await sql`select kind, ip, created_at::text as at from security_event where user_id = ${userId} order by created_at desc limit 500`;
  const consents = await withUser(sql, userId, (tx) => tx`select purpose, action, notice_version, source, created_at::text as at from consent_event order by created_at`);
  const requests = await listPrivacyRequests(sql, userId);
  return { generatedAt: new Date().toISOString(), noticeVersion: NOTICE_VERSION, profile: u ?? null, businesses: memberships, signedInDevices: sessions, securityLog: events, consents, privacyRequests: requests };
}
