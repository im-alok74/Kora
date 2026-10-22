import { SYSTEM_USER, withTenant, type Sql } from '@kora/db';
import type { PaymentGateway } from '@kora/adapters';
import { checkFile } from './attachments.js';
import { getBlobStore } from './blobs.js';
import { randomUUID } from 'node:crypto';
import { resolvePortal } from './portal.js';
import { customerStatement } from './registers.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, todayIn, ValidationError } from './validation.js';

/** Everything the customer can do beyond viewing: pay several invoices at once, comment, attach a purchase order, download a statement. */
const RECEIVABLE = ['tax_invoice', 'bill_of_supply', 'debit_note'];
export const MAX_BULK_INVOICES = 20;
export const MAX_CUSTOMER_FILES = 3;
const system = (businessId: string) => ({ businessId, userId: SYSTEM_USER });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rs = (p: bigint) => `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;

/**
 * One payment for several of this customer's invoices. The hosted page asks for the total; when the gateway confirms, the money is
 * spread over the invoices in order (see applyGatewayEvent). Reuses the link if the same invoices owe the same total.
 */
export async function portalBulkPaymentLink(sql: Sql, token: string, gateway: PaymentGateway, documentIds: string[]) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const ids = [...new Set((documentIds ?? []).map(String))];
  if (ids.length < 2) throw new ValidationError('Choose at least two invoices to pay together.');
  if (ids.length > MAX_BULK_INVOICES) throw new ValidationError(`Choose at most ${MAX_BULK_INVOICES} invoices at a time.`);
  if (ids.some((i) => !UUID.test(i))) throw new ValidationError('Invoice not found.');

  const ctx = await withTenant(sql, system(who.businessId), async (tx) => {
    const docs = await tx`
      select d.id, d.number, d.doc_date, (d.grand_total_paise - d.amount_settled_paise) as outstanding, p.name, p.phone, p.email
        from document d join party p on p.id = d.party_id
       where d.id in ${tx(ids)} and d.party_id in (select party_family(${who.partyId})) and d.status = 'issued' and d.doc_type in ${tx(RECEIVABLE)}
       order by d.doc_date, d.number`;
    if (docs.length !== ids.length) throw new ValidationError('One of those invoices was not found.');
    if (docs.some((d) => BigInt(d.outstanding as string) <= 0n)) throw new ValidationError('One of those invoices is already paid. Refresh the page and choose again.');
    const total = docs.reduce((n, d) => n + BigInt(d.outstanding as string), 0n);
    const sorted = docs.map((d) => d.id as string).sort();
    const [existing] = await tx`
      select l.id, l.url, l.amount_paise from payment_link l
       where l.gateway = ${gateway.name} and l.status = 'created' and l.amount_paise = ${total.toString()}
         and (select array_agg(i.document_id::text order by i.document_id::text) from payment_link_item i where i.link_id = l.id) = ${sorted}::text[]
       order by l.created_at desc limit 1`;
    return { docs, total, existing };
  });
  if (ctx.existing) return { url: ctx.existing.url as string, amountPaise: ctx.existing.amount_paise as string, reused: true, count: ctx.docs.length };

  const first = ctx.docs[0]!;
  const link = await gateway.createPaymentLink({
    amountPaise: ctx.total, referenceId: first.id as string, description: `Invoices ${ctx.docs.map((d) => d.number).join(', ')}`.slice(0, 250),
    customer: { name: first.name as string | null, phone: first.phone as string | null, email: first.email as string | null },
  });
  await withTenant(sql, system(who.businessId), async (tx) => {
    const [l] = await tx`insert into payment_link (business_id, document_id, gateway, gateway_link_id, url, amount_paise)
                         values (${who.businessId}, ${first.id as string}, ${gateway.name}, ${link.gatewayLinkId}, ${link.url}, ${ctx.total.toString()}) returning id`;
    for (const d of ctx.docs) {
      await tx`insert into payment_link_item (link_id, business_id, document_id, amount_paise) values (${l!.id}, ${who.businessId}, ${d.id as string}, ${BigInt(d.outstanding as string).toString()})`;
    }
  });
  return { url: link.url, amountPaise: ctx.total.toString(), reused: false, count: ctx.docs.length };
}

// ---------------------------------------------------------------- comments and purchase orders
async function ownDoc(tx: import('@kora/db').Tx, partyId: string, documentId: string, types?: string[]) {
  if (!UUID.test(documentId)) return null;
  const [d] = await tx`select id, doc_type, number from document where id = ${documentId} and party_id in (select party_family(${partyId})) and status = 'issued'`;
  if (!d || (types && !types.includes(d.doc_type as string))) return null;
  return d;
}

export async function portalComments(sql: Sql, token: string, documentId: string) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  return withTenant(sql, system(who.businessId), async (tx) => {
    if (!(await ownDoc(tx, who.partyId, documentId))) throw new ValidationError('Document not found.');
    const comments = await tx`select id, author, body, created_at from portal_comment where document_id = ${documentId} order by created_at`;
    const files = await tx`select id, file_name, content_type, size_bytes, created_at from document_file where document_id = ${documentId} and from_customer order by created_at`;
    return { comments, files };
  });
}

export async function portalAddComment(sql: Sql, token: string, documentId: string, body: string) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const text = str(body, 'Comment', { required: true, max: 1000 })!;
  return withTenant(sql, system(who.businessId), async (tx) => {
    if (!(await ownDoc(tx, who.partyId, documentId, ['estimate', ...RECEIVABLE]))) throw new ValidationError('Document not found.');
    const [c] = await tx`select count(*)::int as n from portal_comment where document_id = ${documentId} and author = 'customer'`;
    if ((c!.n as number) >= 30) throw new ValidationError('That is a lot of comments on one document. Please call the business instead.');
    const [row] = await tx`insert into portal_comment (business_id, document_id, author, body) values (${who.businessId}, ${documentId}, 'customer', ${text}) returning id`;
    return { id: row!.id as string };
  });
}

/** A purchase order or other file the customer sends against an estimate. Same checks as any attachment. */
export async function portalAttachPo(sql: Sql, token: string, documentId: string, file: { name: string; type: string; dataBase64: string }) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const { name, data } = checkFile(file);
  const store = getBlobStore();
  const key = store ? `${who.businessId}/documents/${documentId}-${randomUUID()}` : null;
  if (store && key) await store.put(key, data, file.type);
  try {
    return await withTenant(sql, system(who.businessId), async (tx) => {
      if (!(await ownDoc(tx, who.partyId, documentId, ['estimate']))) throw new ValidationError('Estimate not found.');
      const [c] = await tx`select count(*)::int as n from document_file where document_id = ${documentId} and from_customer`;
      if ((c!.n as number) >= MAX_CUSTOMER_FILES) throw new ValidationError(`You can attach up to ${MAX_CUSTOMER_FILES} files to an estimate.`);
      const [row] = await tx`insert into document_file (business_id, document_id, file_name, content_type, size_bytes, data, storage_key, created_by, from_customer)
                             values (${who.businessId}, ${documentId}, ${name}, ${file.type}, ${data.length}, ${key ? null : data}, ${key}, null, true) returning id`;
      return { id: row!.id as string };
    });
  } catch (e) {
    if (store && key) await store.delete(key).catch(() => {});
    throw e;
  }
}

/** Staff: everything this customer has said or sent through their portal, newest first. */
export async function listPortalActivity(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const comments = await tx`
      select c.id, c.author, c.body, c.created_at, d.id as document_id, d.number, d.doc_type
        from portal_comment c join document d on d.id = c.document_id where d.party_id = ${partyId} order by c.created_at desc limit 100`;
    const files = await tx`
      select f.id, f.file_name, f.content_type, f.size_bytes, f.created_at, d.id as document_id, d.number
        from document_file f join document d on d.id = f.document_id where d.party_id = ${partyId} and f.from_customer order by f.created_at desc limit 100`;
    return { comments, files };
  });
}

/** Staff: answer a customer's comment. It shows on their portal under the document. */
export async function replyPortalComment(sql: Sql, t: TenantSession, documentId: string, body: string) {
  const text = str(body, 'Reply', { required: true, max: 1000 })!;
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [d] = await tx`select id from document where id = ${documentId} and party_id is not null`;
    if (!d) throw new ValidationError('Document not found.');
    const [row] = await tx`insert into portal_comment (business_id, document_id, author, body) values (${t.businessId}, ${documentId}, 'business', ${text}) returning id`;
    return { id: row!.id as string };
  });
}

// ---------------------------------------------------------------- statement as a PDF
/** The statement the customer sees, with who sent it and what is owed by age, ready for the PDF renderer. */
export async function portalStatementPdfData(sql: Sql, token: string, f: { from?: string; to?: string } = {}) {
  const who = await resolvePortal(sql, token);
  if (!who) return null;
  const statement = await customerStatement(sql, { businessId: who.businessId, userId: SYSTEM_USER, role: 'owner' }, who.partyId, f);
  return withTenant(sql, system(who.businessId), async (tx) => {
    const [supplier] = await tx`select legal_name, trade_name, gstin, address, phone, timezone from business where id = ${who.businessId}`;
    const [tpl] = await tx`select config->>'accent' as accent from document_template where business_id = ${who.businessId} and is_default limit 1`;
    const today = todayIn(supplier!.timezone as string);
    const open = await tx`select (${today}::date - due_date) as late, outstanding_paise::text as o from receivable where party_id in (select party_family(${who.partyId}))`;
    const ageing: Record<string, bigint> = { not_due: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n };
    for (const r of open) {
      const d = r.late as number;
      ageing[d <= 0 ? 'not_due' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus']! += BigInt(r.o as string);
    }
    return { statement, supplier: supplier!, accent: (tpl?.accent as string | undefined) ?? undefined, ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, v.toString()])) };
  });
}

export const bulkTotalText = rs;
