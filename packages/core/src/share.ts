import { createHash, randomBytes } from 'node:crypto';
import { SYSTEM_USER, withTenant, type Sql } from '@kora/db';
import { decideEstimate } from './estimates.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/** Creates a public link to an issued document. Only a hash of the token is stored. */
export async function createShareLink(sql: Sql, t: TenantSession, documentId: string, opts: { expiresInDays?: number } = {}) {
  const token = randomBytes(18).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  await inTenant(sql, t, 'document.issue', async (tx) => {
    const [d] = await tx`select status from document where id = ${documentId}`;
    if (!d || d.status === 'draft') throw new ValidationError('Issue the document before sharing it.');
    await tx`insert into share_link (business_id, document_id, token_hash, expires_at)
             values (${t.businessId}, ${documentId}, ${hash},
                     ${opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400_000) : null})`;
  });
  return { token };
}

export async function revokeShareLinks(sql: Sql, t: TenantSession, documentId: string): Promise<void> {
  await inTenant(sql, t, 'document.issue', (tx) =>
    tx`update share_link set revoked_at = now() where document_id = ${documentId} and revoked_at is null`);
}

export async function shareStats(sql: Sql, t: TenantSession, documentId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`
    select coalesce(sum(view_count), 0)::int as views, min(first_viewed_at) as first_viewed_at, max(last_viewed_at) as last_viewed_at
      from share_link where document_id = ${documentId}`);
  return rows[0]!;
}

/** The public page. Counts a view. No tenant session needed. */
export async function getPublicDocument(sql: Sql, token: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const [r] = await sql`select public_document(${token}) as doc`;
  return (r?.doc as Record<string, any> | null) ?? null;
}

const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * Where a shared quote stands, for the public page. Null for anything that is not an issued estimate behind a live link,
 * so the page only offers an answer when there is one to give. Does not count a view.
 */
export async function publicEstimateInfo(sql: Sql, token: string) {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`select business_id, document_id from share_resolve(${token})`;
  if (!r) return null;
  return withTenant(sql, { businessId: r.business_id as string, userId: SYSTEM_USER }, async (tx) => {
    const [e] = await tx`select d.number, d.due_date::text as valid_until, d.version,
                                estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) as status,
                                es.decision, es.decision_comment as comment, es.decided_by_name as name, es.decided_at
                           from document d join business b on b.id = d.business_id left join estimate_state es on es.document_id = d.id
                          where d.id = ${r.document_id} and d.doc_type = 'estimate' and d.status <> 'draft'`;
    return e ? ({ documentId: r.document_id as string, ...e } as Record<string, any>) : null;
  });
}

/** The customer's answer to a shared quote, with an optional comment and the name they give. */
export async function publicAnswerEstimate(sql: Sql, token: string, decision: 'accepted' | 'declined', answer: { comment?: string; name?: string }) {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`select business_id, document_id from share_resolve(${token})`;
  if (!r) return null;
  if (decision === 'declined' && !answer.comment?.trim()) throw new ValidationError('Please tell them briefly why, so they can fix the quote.', 'comment');
  if (!answer.name?.trim()) throw new ValidationError('Please type your name.', 'name');
  const t = { businessId: r.business_id as string, userId: SYSTEM_USER, role: 'owner' } as const;
  const out = await decideEstimate(sql, t as never, r.document_id as string, decision, 'portal', answer);
  return { status: (out.estimate as { status: string } | null)?.status ?? decision };
}
