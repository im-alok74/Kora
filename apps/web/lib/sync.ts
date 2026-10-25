'use client';
import { tenantHeaders, getOfflineScope, offlineDatabaseName } from './offlineScope';
import { listDrafts, putDraft, removeDraft, type LocalDraft } from './offline';

export interface SyncResult { synced: number; conflicts: number; errors: number; offline: boolean; signedOut: boolean }

async function send(d: LocalDraft): Promise<Response> {
  const body = JSON.stringify({ ...d.payload, clientRef: d.clientRef, ...(d.baseRev !== null ? { baseRev: d.baseRev } : {}) });
  const init = { headers: { 'content-type': 'application/json', ...tenantHeaders() }, body, credentials: 'same-origin' as const };
  return d.serverId ? fetch(`/api/documents/${d.serverId}`, { method: 'PUT', ...init }) : fetch('/api/documents', { method: 'POST', ...init });
}

async function syncOne(d: LocalDraft, res: SyncResult): Promise<boolean> {
  await putDraft({ ...d, status: 'syncing', error: undefined });
  let r: Response;
  try { r = await send(d); }
  catch { await putDraft({ ...d, status: 'pending' }); res.offline = true; return false; }

  if (r.ok) {
    await removeDraft(d.localId);
    res.synced++;
    return true;
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 || (r.status === 409 && data.code === 'tenant_changed')) { await putDraft({ ...d, status: 'pending' }); res.signedOut = true; return false; }
  if (r.status === 409 && data.code === 'conflict') {
    await putDraft({ ...d, status: 'conflict', conflict: { serverId: data.id, serverRev: data.serverRev }, serverId: data.id });
    res.conflicts++;
    return true;
  }
  if (r.status >= 500 || r.status === 429) { await putDraft({ ...d, status: 'pending' }); res.offline = true; return false; }
  await putDraft({ ...d, status: 'error', error: data.error ?? 'The server could not save this draft.' });
  res.errors++;
  return true;
}

let running = false;

/**
 * Sends every waiting draft to the server, oldest first. One run at a time across tabs. A draft in conflict or with
 * a validation error is left for the person to resolve; it is not retried until they act.
 */
export async function syncDrafts(): Promise<SyncResult> {
  const res: SyncResult = { synced: 0, conflicts: 0, errors: 0, offline: false, signedOut: false };
  if (running || (typeof navigator !== 'undefined' && navigator.onLine === false)) { res.offline = navigator.onLine === false; return res; }
  running = true;
  try {
    const work = async () => {
      const pending = (await listDrafts()).filter((d) => d.status === 'pending' || d.status === 'syncing').sort((a, b) => a.updatedAt - b.updatedAt);
      for (const d of pending) { if (!(await syncOne(d, res))) break; }
    };
    if (typeof navigator !== 'undefined' && 'locks' in navigator) await (navigator as any).locks.request(getOfflineScope() ? offlineDatabaseName(getOfflineScope()!) : 'kora-sync', { ifAvailable: true }, async (lock: unknown) => { if (lock) await work(); });
    else await work();
  } finally { running = false; }
  return res;
}
