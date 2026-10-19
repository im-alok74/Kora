'use client';
import { useCallback, useEffect, useState } from 'react';
import { listDrafts, onDraftsChanged, type LocalDraft } from '../lib/offline';
import { syncDrafts } from '../lib/sync';

/** Registers the service worker, keeps the offline pages warm, and syncs waiting drafts. Shows what is going on. */
export default function SyncStatus() {
  const [online, setOnline] = useState(true);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(() => { void listDrafts().then(setDrafts); }, []);
  const sync = useCallback(async () => {
    setSyncing(true);
    const r = await syncDrafts();
    setSyncing(false);
    if (r.synced) setNote(`${r.synced} draft${r.synced === 1 ? '' : 's'} synced.`);
    refresh();
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const off = onDraftsChanged(refresh);
    const goOnline = () => { setOnline(true); void sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline);
    const onVisible = () => { if (document.visibilityState === 'visible') void sync(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { void sync(); }, 20_000);
    void sync();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((reg) => reg.active?.postMessage({ type: 'warm' })).catch(() => {});
    }
    return () => { off(); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [refresh, sync]);

  const waiting = drafts.filter((d) => d.status === 'pending' || d.status === 'syncing');
  const conflicts = drafts.filter((d) => d.status === 'conflict');
  const errors = drafts.filter((d) => d.status === 'error');
  if (online && !drafts.length && !note) return <div data-testid="sync-status" data-state="ok" hidden />;

  return (
    <div role="status" data-testid="sync-status" data-state={!online ? 'offline' : drafts.length ? 'pending' : 'ok'}
      style={{ background: !online ? 'var(--surface)' : 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 14 }}>
      {!online && <div><b>You are offline.</b> Drafts you save stay on this device and sync when you are back online. Issuing needs a connection.</div>}
      {waiting.length > 0 && <div>{waiting.length} draft{waiting.length === 1 ? '' : 's'} saved on this device{online ? '' : ', waiting for a connection'}.{' '}
        {online && <button className="link" onClick={() => sync()} disabled={syncing}>{syncing ? 'Syncing' : 'Sync now'}</button>}</div>}
      {conflicts.length > 0 && <div className="error">{conflicts.length} draft{conflicts.length === 1 ? ' was' : 's were'} changed on another device.{' '}
        {conflicts.map((c) => <a key={c.localId} href={`/app/invoices/offline?d=${c.localId}`}>Choose which to keep</a>)}</div>}
      {errors.length > 0 && <div className="error">{errors.length} draft{errors.length === 1 ? '' : 's'} could not be saved: {errors[0]!.error}{' '}
        {errors.map((c) => <a key={c.localId} href={`/app/invoices/offline?d=${c.localId}`}>Fix it</a>)}</div>}
      {online && note && !waiting.length && <div className="ok">{note}</div>}
    </div>
  );
}
