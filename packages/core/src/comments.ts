import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

/** Team notes on a document. They are for the people in the business and are never printed or shown to a customer. */
export async function addComment(sql: Sql, t: TenantSession, documentId: string, body: string) {
  const text = str(body, 'Comment', { required: true, max: 1000 })!;
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [d] = await tx`select id from document where id = ${documentId}`;
    if (!d) throw new ValidationError('Document not found.');
    const [row] = await tx`insert into document_comment (business_id, document_id, user_id, body) values (${t.businessId}, ${documentId}, ${t.userId}, ${text}) returning id`;
    return { id: row!.id as string };
  });
}

export async function listComments(sql: Sql, t: TenantSession, documentId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`
    select c.id, c.body, c.created_at, c.user_id, coalesce(m.display_name, m.email, m.phone, 'Someone who has left') as author
      from document_comment c left join list_members() m on m.user_id = c.user_id
     where c.document_id = ${documentId} order by c.created_at`);
  return rows.map((r) => ({ id: r.id as string, body: r.body as string, createdAt: r.created_at as string, author: r.author as string, mine: r.user_id === t.userId }));
}

/** A person can remove their own note. An owner can remove anyone's. */
export async function removeComment(sql: Sql, t: TenantSession, documentId: string, commentId: string): Promise<void> {
  await inTenant(sql, t, 'document.write', async (tx) => {
    const [c] = await tx`select user_id from document_comment where id = ${commentId} and document_id = ${documentId}`;
    if (!c) throw new ValidationError('Comment not found.');
    if (c.user_id !== t.userId && t.role !== 'owner') throw new ValidationError('Only the person who wrote a note, or an owner, can remove it.');
    await tx`delete from document_comment where id = ${commentId}`;
  });
}
