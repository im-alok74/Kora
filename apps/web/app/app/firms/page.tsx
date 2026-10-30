'use client';
import { useCallback, useEffect, useState } from 'react';
import KoraLoader from '../../../components/KoraLoader';
import { api } from '../../../lib/client';

type Link = { linkId: string; firmName: string; clientName: string; status: string; createdAt: string };

/** For the owner of a business: which accounting firms can read this business, and accepting a new one with the code the firm gave you. */
export default function Firms() {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => setLinks((await api<{ links: Link[] }>('/api/business/firm-links')).links), []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setNote(''); try { await fn(); await load(); if (ok) setNote(ok); } catch (e) { setErr((e as Error).message); } };

  if (!links) return err ? <p className="error" role="alert">{err}</p> : <KoraLoader />;
  const active = links.filter((l) => l.status === 'active');
  return (
    <>
      <div className="toolbar"><div><h1>Accounting firms</h1><p className="page-sub">Who can read this business&apos;s books. Only an owner can allow or stop it.</p></div></div>
      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}

      <form className="panel filters" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/business/firm-links', { body: { code } }); setCode(''); }, 'Done. The firm can now read this business, and only read.'); }}>
        <div style={{ flex: 3 }}><label htmlFor="fc">Code from your accounting firm</label><input id="fc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDE-FGHJK" required /></div>
        <button className="btn">Allow the firm</button>
        <p className="muted" style={{ flexBasis: '100%', margin: 0 }}>They can see your dashboard and your GSTR-2B differences. They cannot change anything, and their people are not added to your team. You can stop it at any time.</p>
      </form>

      {active.length === 0 ? (
        <div className="panel empty"><h3>No firm can read this business</h3><p>When your CA asks, enter the code they give you above.</p></div>
      ) : (
        <table className="t" aria-label="Firms with access">
          <thead><tr><th>Firm</th><th>Their name for you</th><th>Since</th><th /></tr></thead>
          <tbody>{active.map((l) => (
            <tr key={l.linkId}>
              <td><b>{l.firmName}</b></td><td>{l.clientName}</td><td>{l.createdAt.slice(0, 10)}</td>
              <td><button className="secondary sm" onClick={() => { if (window.confirm(`Stop ${l.firmName} reading this business?`)) void run(() => api(`/api/business/firm-links?linkId=${l.linkId}`, { method: 'DELETE' })); }}>Stop access</button></td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
