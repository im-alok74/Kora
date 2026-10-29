import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from '@kora/db';
import { getBlobStore } from './blobs.js';
import { keep } from './firmrequests.js';
import { reviewStateOf } from './firmsubmission.js';
import { inFirm, seesAllClients, type FirmSession } from './firmtenancy.js';
import { loadEngagement } from './firmwork.js';
import { checkUpload } from './inbox.js';
import { ValidationError } from './validation.js';

const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

export interface EvidenceRow { id: string; reference: string; filedOn: string; fileName: string; markedBy: string; createdAt: string }

/**
 * Records that the return was filed: the reference (for example the ARN), the date the filer states, and the acknowledgement file.
 * This is the firm's own note. Kora has not checked it with the GST portal, and says so wherever it shows it.
 * Only after an approved review whose files are unchanged, so nothing unreviewed is recorded as filed.
 */
export async function addFilingEvidence(sql: Sql, s: FirmSession, engagementId: string, e: { reference: string; filedOn: string; file: { name: string; type: string; dataBase64: string } }): Promise<string> {
  const reference = (e.reference ?? '').trim();
  if (!reference || reference.length > 60) throw new ValidationError('Enter the filing reference, for example the ARN (up to 60 characters).', 'reference');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.filedOn ?? '') || Number.isNaN(Date.parse(e.filedOn))) throw new ValidationError('Enter the date it was filed, like 2026-10-20.', 'filedOn');
  if (e.filedOn > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw new ValidationError('The filing date cannot be in the future.', 'filedOn');
  const file = checkUpload(e.file);
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    const st = await reviewStateOf(tx, engagementId);
    if (st.effective !== 'approved') throw new ValidationError(st.effective === 'stale' ? 'Something changed after the review was approved. Send it for review again before recording a filing.' : 'The work needs an approved review before a filing can be recorded.');
    const id = randomUUID();
    const { key, data } = await keep(s.firmId, id, file);
    await tx`insert into filing_evidence (id, firm_id, engagement_id, reference, filed_on, file_name, content_type, size_bytes, sha256, data, storage_key, marked_by)
             values (${id}, ${s.firmId}, ${engagementId}, ${reference}, ${e.filedOn}, ${file.name}, ${file.type}, ${file.data.length}, ${createHash('sha256').update(file.data).digest('hex')}, ${data}, ${key}, ${s.userId})`;
    return id;
  });
}

export async function listFilingEvidence(sql: Sql, s: FirmSession, engagementId: string): Promise<EvidenceRow[]> {
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    await loadEngagement(tx, s, engagementId);
    const rows = await tx`select id, reference, filed_on, file_name, marked_by, created_at from filing_evidence where engagement_id = ${engagementId} order by created_at desc`;
    return rows.map((r) => ({ id: r.id, reference: r.reference, filedOn: iso(r.filed_on), fileName: r.file_name, markedBy: r.marked_by, createdAt: new Date(r.created_at).toISOString() }));
  });
}

export async function getEvidenceFile(sql: Sql, s: FirmSession, id: string): Promise<{ name: string; type: string; data: Buffer } | null> {
  const row = await inFirm(sql, s, 'engagement.read', async (tx) => {
    const [r] = await tx`select engagement_id, file_name, content_type, data, storage_key from filing_evidence where id = ${id} and firm_id = ${s.firmId}`;
    if (!r) return null;
    await loadEngagement(tx, s, r.engagement_id as string);
    return r;
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

/**
 * Finishes the work. Needs: an approved review whose files are unchanged, filing evidence on record, and no open blocker.
 * Only a partner, a manager or the assigned reviewer can close it.
 */
export async function closeEngagement(sql: Sql, s: FirmSession, engagementId: string): Promise<void> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const e = await loadEngagement(tx, s, engagementId);
    if (!seesAllClients(s.role) && e.reviewer_id !== s.userId) throw new ValidationError('Only a partner, a manager or the assigned reviewer can close this work.');
    if (e.status === 'done') throw new ValidationError('This work is already closed.');
    const [b] = await tx`select blocker_reason from engagement where id = ${engagementId}`;
    if (b?.blocker_reason) throw new ValidationError('Clear what is holding this work up before closing it.');
    const st = await reviewStateOf(tx, engagementId);
    if (st.effective !== 'approved') throw new ValidationError(st.effective === 'stale' ? 'Something changed after the review was approved. Send it for review again.' : 'The work needs an approved review before it can be closed.');
    const [ev] = await tx`select 1 as ok from filing_evidence where engagement_id = ${engagementId} limit 1`;
    if (!ev) throw new ValidationError('Record the filing (reference, date and acknowledgement file) before closing.');
    await tx`update engagement set status = 'done', updated_at = now() where id = ${engagementId}`;
  });
}
