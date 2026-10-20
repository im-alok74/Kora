import { randomUUID } from 'node:crypto';
import type { Sql } from '@kora/db';
import { getBlobStore } from './blobs.js';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from './expenses.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

/** Files that can be attached to a document, and how many. Same types and size limit as a receipt. */
export const MAX_ATTACHMENTS = 3;

/** The first bytes must match what the file claims to be, so a renamed file cannot be stored as a picture or PDF. */
function checkFile(file: { name: string; type: string; dataBase64: string }): { name: string; data: Buffer } {
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) throw new ValidationError('An attachment can be a JPEG or PNG picture, or a PDF.', 'type');
  const name = str(file.name, 'File name', { required: true, max: 120 })!.replace(/[^\w.\- ]+/g, '_');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(file.dataBase64)) throw new ValidationError('The file could not be read.', 'data');
  const data = Buffer.from(file.dataBase64, 'base64');
  if (data.length === 0) throw new ValidationError('The file is empty.', 'data');
  if (data.length > RECEIPT_MAX_BYTES) throw new ValidationError('The file is larger than 2 MB. Use a smaller one.', 'data');
  const ok = file.type === 'application/pdf' ? data.subarray(0, 4).toString('latin1') === '%PDF'
    : file.type === 'image/png' ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!ok) throw new ValidationError('The file does not look like a real file of that type.', 'data');
  return { name, data };
}

export async function addAttachment(sql: Sql, t: TenantSession, documentId: string, file: { name: string; type: string; dataBase64: string }) {
  const { name, data } = checkFile(file);
  const store = getBlobStore();
  const key = store ? `${t.businessId}/documents/${documentId}-${randomUUID()}` : null;
  if (store && key) await store.put(key, data, file.type);
  try {
    return await inTenant(sql, t, 'document.write', async (tx) => {
      const [d] = await tx`select id from document where id = ${documentId}`;
      if (!d) throw new ValidationError('Document not found.');
      const [c] = await tx`select count(*)::int as n from document_file where document_id = ${documentId}`;
      if ((c!.n as number) >= MAX_ATTACHMENTS) throw new ValidationError(`A document can have at most ${MAX_ATTACHMENTS} attachments. Remove one first.`);
      const [row] = await tx`insert into document_file (business_id, document_id, file_name, content_type, size_bytes, data, storage_key, created_by)
                             values (${t.businessId}, ${documentId}, ${name}, ${file.type}, ${data.length}, ${key ? null : data}, ${key}, ${t.userId}) returning id`;
      return { id: row!.id as string };
    });
  } catch (e) {
    if (store && key) await store.delete(key).catch(() => {});
    throw e;
  }
}

export async function listAttachments(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'document.read', (tx) => tx`
    select id, file_name, content_type, size_bytes, created_at from document_file where document_id = ${documentId} order by created_at`);
}

export async function getAttachment(sql: Sql, t: TenantSession, documentId: string, fileId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`
    select file_name, content_type, data, storage_key from document_file where id = ${fileId} and document_id = ${documentId}`);
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

export async function removeAttachment(sql: Sql, t: TenantSession, documentId: string, fileId: string): Promise<void> {
  const key = await inTenant(sql, t, 'document.write', async (tx) => {
    const [r] = await tx`delete from document_file where id = ${fileId} and document_id = ${documentId} returning storage_key`;
    if (!r) throw new ValidationError('Attachment not found.');
    return (r.storage_key as string | null) ?? null;
  });
  if (key) await getBlobStore()?.delete(key).catch(() => {});
}
