import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from './expenses.js';
import { getBlobStore } from './blobs.js';
import { scanUpload } from './uploadscan.js';

export const INBOX_STATUSES = ['new', 'done', 'rejected'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** Checks an uploaded file: type, name, readable base64, size up to 2 MB, and that the first bytes match the claimed type. Shared by the inbox and the firm's requests. */
export function checkUpload(i: { name: string; type: string; dataBase64: string }): { name: string; type: string; data: Buffer } {
  if (!(RECEIPT_TYPES as readonly string[]).includes(i.type)) throw new ValidationError('The file can be a JPEG or PNG photo, or a PDF.', 'type');
  const name = str(i.name, 'File name', { required: true, max: 120 })!.replace(/[^\w.\- ]+/g, '_');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(i.dataBase64)) throw new ValidationError('The file could not be read.', 'data');
  const data = Buffer.from(i.dataBase64, 'base64');
  if (data.length === 0) throw new ValidationError('The file is empty.', 'data');
  if (data.length > RECEIPT_MAX_BYTES) throw new ValidationError('The file is larger than 2 MB. Use a smaller photo.', 'data');
  const magic = i.type === 'application/pdf' ? data.subarray(0, 4).toString('latin1') === '%PDF'
    : i.type === 'image/png' ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!magic) throw new ValidationError('The file does not look like a real file of that type.', 'data');
  const unsafe = scanUpload(data, i.type);
  if (unsafe) throw new ValidationError(unsafe, 'data');
  return { name, type: i.type, data };
}

/** A client hands over a bill or paper. The accountant later marks it done, or sends it back with a reason. */
export async function addToInbox(sql: Sql, t: TenantSession, i: { title: string; note?: string | null; name: string; type: string; dataBase64: string }): Promise<{ id: string }> {
  const { name, data } = checkUpload(i);
  const title = str(i.title, 'Title', { required: true, max: 120 })!;
  const note = str(i.note, 'Note', { max: 1000 });
  const store = getBlobStore();
  try {
    return await inTenant(sql, t, 'inbox.upload', async (tx) => {
      const [r] = await tx`insert into inbox_item (business_id, title, note, file_name, content_type, uploaded_by)
                           values (${t.businessId}, ${title}, ${note}, ${name}, ${i.type}, ${t.userId}) returning id`;
      const key = store ? `${t.businessId}/inbox/${r!.id}` : null;
      if (store && key) await store.put(key, data, i.type);
      await tx`insert into inbox_file (item_id, business_id, data, storage_key) values (${r!.id}, ${t.businessId}, ${key ? null : data}, ${key})`;
      return { id: r!.id as string };
    });
  } catch (e) {
    throw e;
  }
}

export async function listInbox(sql: Sql, t: TenantSession, f: { status?: string } = {}) {
  if (f.status && !(INBOX_STATUSES as readonly string[]).includes(f.status)) throw new ValidationError('Choose a status.', 'status');
  return inTenant(sql, t, 'inbox.read', (tx) => tx`
    select i.id, i.title, i.note, i.file_name, i.content_type, i.status, i.review_note, i.created_at, i.reviewed_at,
           u.email as uploaded_by_email, r.email as reviewed_by_email
      from inbox_item i left join app_user u on u.id = i.uploaded_by left join app_user r on r.id = i.reviewed_by
     where (${f.status ?? null}::text is null or i.status = ${f.status ?? null})
     order by (i.status = 'new') desc, i.created_at desc limit 200`);
}

/** Marks an item done, or rejects it with a reason the client can read. A reviewed item can be reopened. */
export async function reviewInbox(sql: Sql, t: TenantSession, id: string, d: { status: InboxStatus; reviewNote?: string | null }): Promise<void> {
  if (!(INBOX_STATUSES as readonly string[]).includes(d.status)) throw new ValidationError('Choose a status.', 'status');
  const reviewNote = str(d.reviewNote, 'Reason', { max: 1000 });
  if (d.status === 'rejected' && !reviewNote) throw new ValidationError('Say what is wrong, so the client knows what to send instead.', 'reviewNote');
  await inTenant(sql, t, 'inbox.review', async (tx) => {
    const reopen = d.status === 'new';
    const r = await tx`update inbox_item set status = ${d.status}, review_note = ${reopen ? null : reviewNote},
                              reviewed_by = ${reopen ? null : t.userId}, reviewed_at = ${reopen ? null : new Date()} where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('That item was not found.');
  });
}

/** Whoever uploaded an item can take it back while it is new. An owner can remove any item. */
export async function removeFromInbox(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'inbox.read', async (tx) => {
    const [i] = await tx`select uploaded_by, status from inbox_item where id = ${id}`;
    if (!i) throw new ValidationError('That item was not found.');
    const mine = i.uploaded_by === t.userId && i.status === 'new';
    if (!mine && t.role !== 'owner') throw new ValidationError('Only the person who sent this, or an owner, can remove it.');
    const [f] = await tx`select storage_key from inbox_file where item_id = ${id}`;
    await tx`delete from inbox_item where id = ${id}`;
    const key = (f?.storage_key as string | null) ?? null;
    if (key) await getBlobStore()?.delete(key).catch(() => {});
  });
}

export async function getInboxFile(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'inbox.read', (tx) => tx`select i.file_name, i.content_type, f.data, f.storage_key from inbox_item i join inbox_file f on f.item_id = i.id where i.id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  let data = r.data as Buffer | null;
  if (!data && r.storage_key) {
    const store = getBlobStore();
    if (!store) throw new Error('This file is in object storage, which is not configured here.');
    data = await store.get(r.storage_key as string);
    if (!data) return null;
  }
  return { name: r.file_name as string, type: r.content_type as string, data: data! };
}
