import { createHash, randomBytes } from 'node:crypto';
import { SYSTEM_USER, withTenant, type Sql } from '@kora/db';
import type { PaymentGateway } from '@kora/adapters';
import { decideEstimate } from './estimates.js';
import { createPaymentLink } from './payments.js';
import { customerStatement } from './registers.js';
import { createShareLink } from './share.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * The client portal: one private link per customer. The customer needs no account. The link's token is long and random,
 * only its hash is stored, and the owner can replace or stop it at any time.
 *
 * Every public function here starts from the token, finds the one business and customer it belongs to, and then
 * reads or changes only that customer's documents. None of them takes an id from the visitor without checking that
 * it belongs to that customer first.
 */
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;
const RECEIVABLE = ['tax_invoice', 'bill_of_supply', 'debit_note'];

/** The portal acts as the automatic system user, inside the one business the link belongs to. */
const portalSession = (businessId: string): TenantSession => ({ businessId, userId: SYSTEM_USER, role: 'owner' });

export async function createPortalLink(sql: Sql, t: TenantSession, partyId: string): Promise<{ token: string }> {
  const token = randomBytes(18).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  await inTenant(sql, t, 'document.issue', async (tx) => {
    const [p] = await tx`select id from party where id = ${partyId}`;
    if (!p) throw new ValidationError('Customer not found.');
    await tx`update portal_link set revoked_at = now() where party_id = ${partyId} and revoked_at is null`;
    await tx`insert into portal_link (business_id, party_id, token_hash, created_by) values (${t.businessId}, ${partyId}, ${hash}, ${t.userId})`;
  });
  return { token };
}

export async function revokePortalLink(sql: Sql, t: TenantSession, partyId: string): Promise<void> {
  await inTenant(sql, t, 'document.issue', (tx) => tx`update portal_link set revoked_at = now() where party_id = ${partyId} and revoked_at is null`);
}

export async function portalStatus(sql: Sql, t: TenantSession, partyId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) =>
    tx`select created_at, view_count, first_viewed_at, last_viewed_at from portal_link where party_id = ${partyId} and revoked_at is null`);
  return rows[0] ? { active: true as const, ...rows[0] } : { active: false as const };
}

/** Finds the business and customer a live link belongs to. With count, also records that the page was opened. */
export async function resolvePortal(sql: Sql, token: string, count = false): Promise<{ businessId: string; partyId: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`select business_id, party_id from portal_lookup(${token}, ${count})`;
  return r ? { businessId: r.business_id as string, partyId: r.party_id as string } : null;
}

/** What the customer sees on opening the portal. Counts a view. */
export async function portalOverview(sql: Sql, token: string) {
  const who = await resolvePortal(sql, token, true);
  if (!who) return null;
  return withTenant(sql, { businessId: who.businessId, userId: SYSTEM_USER }, async (tx) => {
    const [biz] = await tx`select legal_name, trade_name, gstin, phone, email, upi_vpa, timezone from business where id = ${who.businessId}`;
    const [party] = await tx`select name from party where id = ${who.partyId}`;
    const invoices = await tx`
      select d.id, d.doc_type, d.number, d.doc_date::text as doc_date, d.due_date::text as due_date, d.grand_total_paise,
             d.amount_settled_paise, d.payment_status,
             (d.grand_total_paise - d.amount_settled_paise) as outstanding_paise,
             (d.grand_total_paise > d.amount_settled_paise
              and coalesce(d.due_date, d.doc_date) < (now() at time zone ${biz!.timezone as string})::date) as overdue
        from document d
       where d.party_id = ${who.partyId} and d.status = 'issued' and d.doc_type in ${tx(RECEIVABLE)}
       order by d.doc_date desc, d.number desc limit 100`;
    const estimates = await tx`
      select d.id, d.number, d.doc_date::text as doc_date, d.due_date::text as valid_until, d.grand_total_paise, d.currency,
             estimate_status(d.status, d.due_date, ${biz!.timezone as string}, es.decision, es.converted_to_id) as status
        from document d left join estimate_state es on es.document_id = d.id
       where d.party_id = ${who.partyId} and d.status = 'issued' and d.doc_type = 'estimate'
       order by d.doc_date desc, d.number desc limit 50`;
    const payments = await tx`
      select method, amount_paise, received_on::text as received_on from payment
       where party_id = ${who.partyId} order by received_on desc, created_at desc limit 10`;
    let outstanding = 0n, overdue = 0n;
    for (const i of invoices) {
      const o = BigInt(i.outstanding_paise as string);
      if (o > 0n) { outstanding += o; if (i.overdue) overdue += o; }
    }
    return {
      business: { name: (biz!.trade_name ?? biz!.legal_name) as string, gstin: biz!.gstin as string | null, phone: biz!.phone as string | null, email: biz!.email as string | null },
      customer: { name: party!.name as string },
      totals: { outstanding: outstanding.toString(), overdue: overdue.toString() },
      invoices, estimates, payments,
    };
  });
}

/** The customer's statement for a period, the same figures the business sees. */
export async function portalStatement(sql: Sql, token: string, f: { from?: string; to?: string } = {}) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  return customerStatement(sql, portalSession(who.businessId), who.partyId, f);
}

async function ownDocument(sql: Sql, who: { businessId: string; partyId: string }, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  return withTenant(sql, { businessId: who.businessId, userId: SYSTEM_USER }, async (tx) => {
    const [d] = await tx`select id, doc_type, status from document where id = ${documentId} and party_id = ${who.partyId} and status = 'issued'`;
    return d ?? null;
  });
}

export async function portalAnswerEstimate(sql: Sql, token: string, documentId: string, decision: 'accepted' | 'declined') {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const d = await ownDocument(sql, who, documentId);
  if (!d || d.doc_type !== 'estimate') throw new ValidationError('Estimate not found.');
  const out = await decideEstimate(sql, portalSession(who.businessId), documentId, decision, 'portal');
  return { status: (out.estimate as { status: string } | null)?.status ?? decision };
}

export async function portalPaymentLink(sql: Sql, token: string, gateway: PaymentGateway, documentId: string) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const d = await ownDocument(sql, who, documentId);
  if (!d || !RECEIVABLE.includes(d.doc_type as string)) throw new ValidationError('Invoice not found.');
  const link = await createPaymentLink(sql, portalSession(who.businessId), gateway, documentId);
  return { url: link.url };
}

/** A public view link for one of the customer's documents, so the portal can open its page and PDF. */
export async function portalDocumentLink(sql: Sql, token: string, documentId: string) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const d = await ownDocument(sql, who, documentId);
  if (!d) throw new ValidationError('Document not found.');
  return createShareLink(sql, portalSession(who.businessId), documentId, { expiresInDays: 1 });
}
