import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '@kora/db';
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
