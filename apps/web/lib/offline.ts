'use client';
import { getOfflineScope, offlineDatabaseName } from './offlineScope';

/**
 * Drafts and reference data kept on this device, in IndexedDB. Everything here fails soft: in a private window or
 * with storage blocked the app still works online, it just cannot save offline.
 */
export type DraftStatus = 'pending' | 'syncing' | 'conflict' | 'error';

export interface LocalDraft {
  localId: string;
  /** Stable reference sent with every sync, so a retry can never create a second document. */
  clientRef: string;
  serverId: string | null;
  /** Revision of the server draft this was based on, for conflict detection. */
  baseRev: number | null;
  payload: Record<string, any>;
  summary: { customer: string; total: string | null };
  status: DraftStatus;
  error?: string;
  conflict?: { serverId: string; serverRev: number };
  updatedAt: number;
}

let activeDB: string | null = null;
const CHANGED = 'kora-drafts-changed';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  const scope = getOfflineScope();
  if (!scope) return Promise.resolve(null);
  const DB = offlineDatabaseName(scope);
  if (activeDB !== DB) { void dbPromise?.then(db => db?.close()); dbPromise = null; activeDB = DB; }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('drafts', { keyPath: 'localId' });
          req.result.createObjectStore('cache', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function run<T>(store: 'drafts' | 'cache', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export const storageAvailable = () => open().then((d) => !!d);
export const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`.padEnd(32, '0'));

export async function listDrafts(): Promise<LocalDraft[]> {
  const all = (await run<LocalDraft[]>('drafts', 'readonly', (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export const getDraft = (id: string) => run<LocalDraft>('drafts', 'readonly', (s) => s.get(id));

export async function putDraft(d: LocalDraft): Promise<boolean> {
  const ok = (await run('drafts', 'readwrite', (s) => s.put({ ...d, updatedAt: Date.now() }))) !== null;
  if (ok && typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
  return ok;
}
export async function removeDraft(id: string): Promise<void> {
  await run('drafts', 'readwrite', (s) => s.delete(id));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await run<{ key: string; value: T }>('cache', 'readonly', (s) => s.get(key));
  return r?.value ?? null;
}
export const cacheSet = (key: string, value: unknown) => run('cache', 'readwrite', (s) => s.put({ key, value, at: Date.now() }));

/** Subscribe to changes in the draft store, in this tab or another. */
export function onDraftsChanged(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb);
  let bc: BroadcastChannel | null = null;
  try { bc = new BroadcastChannel('kora-drafts'); bc.onmessage = cb; } catch { /* not supported */ }
  const relay = () => { try { bc?.postMessage('changed'); } catch { /* closed */ } };
  window.addEventListener(CHANGED, relay);
  return () => { window.removeEventListener(CHANGED, cb); window.removeEventListener(CHANGED, relay); bc?.close(); };
}

/** True when the failure looks like "no network" rather than "the server said no". */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/** Clears the active business's drafts/reference data and private page caches on sign out.
 * Other scoped business drafts are preserved and can only be opened under their original user/business scope.
 * Legacy unscoped databases are deliberately not imported: their owner cannot be established safely.
 */
export async function clearLocalData(): Promise<void> {
  await run('drafts', 'readwrite', (s) => s.clear());
  await run('cache', 'readwrite', (s) => s.clear());
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('kora-offline:')) sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
  try { if ('caches' in window) await Promise.all((await caches.keys()).filter((k) => k.startsWith('kora-')).map((k) => caches.delete(k))); } catch { /* ignore */ }
}
