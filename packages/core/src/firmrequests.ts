import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Sql, Tx } from '@kora/db';
import { getBlobStore } from './blobs.js';
import { FORM_NAME, type Service } from './firmengagement.js';
import { inFirm, type FirmSession } from './firmtenancy.js';
import { loadEngagement } from './firmwork.js';
import { checkUpload } from './inbox.js';
import { ValidationError } from './validation.js';

export type RequestStatus = 'requested' | 'received' | 'needs_correction' | 'accepted' | 'waived';

/** The starting checklist for monthly GST work. A firm can add or remove items per engagement. */
export const DEFAULT_CHECKLIST = ['Sales invoices or sales register for the month', 'Purchase bills or purchase register', 'Bank statement for the month'];
const LINK_DAYS = 14;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hashToken = (t: string) => sha(t.trim());

export interface RequestRow {
  id: string; label: string; status: RequestStatus; reason: string | null; dueDate: string | null;
  versions: { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedVia: string; createdAt: string }[];
}

const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

/** Adds one item to an engagement's checklist. The same label twice is refused. */
export async function addRequest(sql: Sql, s: FirmSession, engagementId: string, r: { label: string; dueDate?: string | null }): Promise<string> {
  const label = (r.label ?? '').trim();
  if (!label || label.length > 200) throw new ValidationError('Say what you need (up to 200 characters).', 'label');
  if (r.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate)) throw new ValidationError('Dates must look like 2026-10-20.', 'dueDate');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const e = await loadEngagement(tx, s, engagementId);
    const [dupe] = await tx`select 1 as ok from document_request where engagement_id = ${engagementId} and lower(label) = lower(${label})`;
    if (dupe) throw new ValidationError('That item is already on the list.', 'label');
    const [row] = await tx`insert into document_request (firm_id, engagement_id, client_id, label, due_date, created_by)
                           values (${s.firmId}, ${engagementId}, ${e.client_id}, ${label}, ${r.dueDate ?? null}, ${s.userId}) returning id`;
    return row!.id as string;
  });
}

/** Adds the standard items that are not on the list yet. Returns how many were added. */
export async function addDefaultChecklist(sql: Sql, s: FirmSession, engagementId: string): Promise<number> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const e = await loadEngagement(tx, s, engagementId);
    let n = 0;
    for (const label of DEFAULT_CHECKLIST) {
      const rows = await tx`insert into document_request (firm_id, engagement_id, client_id, label, created_by)
                            values (${s.firmId}, ${engagementId}, ${e.client_id}, ${label}, ${s.userId}) on conflict do nothing returning id`;
      n += rows.length;
    }
    return n;
  });
}

export async function listRequests(sql: Sql, s: FirmSession, engagementId: string): Promise<RequestRow[]> {
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    const rows = await tx`select id, label, status, reason, due_date from document_request where engagement_id = ${engagementId} order by created_at, id`;
    const ids = rows.map((r) => r.id as string);
    const vs = ids.length ? await tx`select id, request_id, file_name, content_type, size_bytes, uploaded_via, created_at from document_version where request_id = any(${ids}) order by created_at desc` : [];
    return rows.map((r) => ({
      id: r.id, label: r.label, status: r.status, reason: r.reason, dueDate: day(r.due_date),
      versions: vs.filter((v) => v.request_id === r.id).map((v) => ({ id: v.id, fileName: v.file_name, contentType: v.content_type, sizeBytes: v.size_bytes, uploadedVia: v.uploaded_via, createdAt: new Date(v.created_at).toISOString() })),
    }));
  });
}

/** Stores the bytes where the deployment keeps files: object storage when it is set up, the database otherwise. */
export async function keep(firmId: string, versionId: string, file: { type: string; data: Buffer }) {
  const store = getBlobStore();
  const key = store ? `firm/${firmId}/requests/${versionId}` : null;
  if (store && key) await store.put(key, file.data, file.type);
  return { key, data: key ? null : file.data };
}

/** A firm member uploads a file for an item on the client's behalf, for example one that arrived on WhatsApp. */
export async function addStaffVersion(sql: Sql, s: FirmSession, requestId: string, f: { name: string; type: string; dataBase64: string }): Promise<string> {
  const file = checkUpload(f);
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const [r] = await tx`select engagement_id, status from document_request where id = ${requestId} and firm_id = ${s.firmId}`;
    if (!r) throw new ValidationError('That item was not found.');
    await loadEngagement(tx, s, r.engagement_id as string);
    if (r.status === 'accepted' || r.status === 'waived') throw new ValidationError('That item is already closed. Reopen it first.');
    const id = randomUUID();
    const { key, data } = await keep(s.firmId, id, file);
    await tx`insert into document_version (id, firm_id, request_id, file_name, content_type, size_bytes, sha256, data, storage_key, uploaded_by, uploaded_via)
             values (${id}, ${s.firmId}, ${requestId}, ${file.name}, ${file.type}, ${file.data.length}, ${sha(file.data)}, ${data}, ${key}, ${s.userId}, 'staff')`;
    await tx`update document_request set status = 'received', reason = null, updated_at = now() where id = ${requestId}`;
    return id;
  });
}

/** A file the firm holds, for download. Checks the person may see this client. */
export async function getVersionFile(sql: Sql, s: FirmSession, versionId: string): Promise<{ name: string; type: string; data: Buffer } | null> {
  const row = await inFirm(sql, s, 'engagement.read', async (tx) => {
    const [v] = await tx`select v.file_name, v.content_type, v.data, v.storage_key, r.engagement_id from document_version v join document_request r on r.id = v.request_id where v.id = ${versionId} and v.firm_id = ${s.firmId}`;
    if (!v) return null;
    await loadEngagement(tx, s, v.engagement_id as string);
    return v;
  });
  if (!row) return null;
  let data = row.data as Buffer | null;
  if (!data && row.storage_key) {
    const store = getBlobStore();
    if (!store) throw new Error('This file is in object storage, which is not configured here.');
    data = await store.get(row.storage_key as string);
    if (!data) return null;
  }
  return { name: row.file_name as string, type: row.content_type as string, data: data! };
}

// ---------------------------------------------------------------- the link the client opens

/** Makes a link for the client. Any earlier live link for this work stops working. The token is returned once; only its hash is kept. */
export async function createUploadLink(sql: Sql, s: FirmSession, engagementId: string): Promise<{ token: string; expiresAt: string }> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    await tx`update upload_link set revoked_at = now() where engagement_id = ${engagementId} and revoked_at is null`;
    const token = randomBytes(24).toString('base64url');
    const [r] = await tx`insert into upload_link (firm_id, engagement_id, token_hash, expires_at, created_by)
                         values (${s.firmId}, ${engagementId}, ${hashToken(token)}, now() + ${LINK_DAYS + ' days'}::interval, ${s.userId}) returning expires_at`;
    return { token, expiresAt: (r!.expires_at as Date).toISOString() };
  });
}

export async function revokeUploadLink(sql: Sql, s: FirmSession, engagementId: string): Promise<void> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    await tx`update upload_link set revoked_at = now() where engagement_id = ${engagementId} and revoked_at is null`;
  });
}

export async function uploadLinkState(sql: Sql, s: FirmSession, engagementId: string): Promise<{ active: boolean; expiresAt?: string }> {
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    const [l] = await tx`select expires_at from upload_link where engagement_id = ${engagementId} and revoked_at is null and expires_at > now()`;
    return l ? { active: true, expiresAt: (l.expires_at as Date).toISOString() } : { active: false };
  });
}

export interface UploadPage { firm: string; client: string; work: string; items: { id: string; label: string; status: RequestStatus; reason: string | null; dueDate: string | null }[] }

/** What the client sees. Returns null when the link is wrong, expired or revoked, without saying which. */
export async function loadUploadPage(sql: Sql, token: string): Promise<UploadPage | null> {
  const rows = await sql`select * from upload_link_context(${hashToken(token)})`;
  if (!rows.length) return null;
  const first = rows[0]!;
  return {
    firm: first.firm_name, client: first.client_name, work: `${FORM_NAME[first.service as Service]} for ${first.period}`,
    items: rows.filter((r) => r.request_id).map((r) => ({ id: r.request_id, label: r.label, status: r.status, reason: r.reason, dueDate: day(r.due_date) })),
  };
}

/** The client sends a file. Checked like any upload, then handed to the database function that checks the link and the item. */
export async function uploadViaLink(sql: Sql, token: string, requestId: string, f: { name: string; type: string; dataBase64: string }): Promise<void> {
  const file = checkUpload(f);
  const hash = hashToken(token);
  const [ctx] = await sql`select firm_id from upload_link_context(${hash}) limit 1`;
  if (!ctx) throw new ValidationError('This link is not valid any more. Ask the firm for a new one.');
  const id = randomUUID();
  const { key, data } = await keep(ctx.firm_id as string, id, file);
  try {
    await sql`select upload_link_add_version(${hash}, ${requestId}, ${id}, ${file.name}, ${file.type}, ${file.data.length}, ${sha(file.data)}, ${data}, ${key})`;
  } catch (e) {
    if (key) await getBlobStore()?.delete(key).catch(() => {});
    if ((e as { code?: string }).code === '23514') {
      if (/upload limit/.test((e as Error).message)) throw new ValidationError('You have sent the most files this link allows. Ask your CA to review what you have sent, or for a new link.');
      throw new ValidationError('That could not be saved: the link may have expired, or the item is already closed.');
    }
    throw e;
  }
}
