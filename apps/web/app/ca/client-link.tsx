'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, rupees } from '../../lib/client';

type Link = { status: 'none' | 'pending' | 'active'; expiresAt?: string };
type Summary = { owed: { outstanding: string; overdue: string; overdueCount: number }; attention: { drafts: number } };
type Recon = { period: string; loaded: number; matched: number; mismatched: number; onlyIn2b: number; onlyInBooks: number } | null;

/** Whether this client's Kora books are shared with the firm, and what the firm can see of them. The client's owner has to accept; either side can stop it. */
export default function ClientLink({ clientId, wide }: { clientId: string; wide: boolean }) {
  const [link, setLink] = useState<Link | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recon, setRecon] = useState<Recon>(null);
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ link: Link; summary?: Summary; reconciliation?: Recon }>(`/api/ca/clients/${clientId}/link`);
    setLink(r.link); setSummary(r.summary ?? null); setRecon(r.reconciliation ?? null);
  }, [clientId]);
  useEffect(() => { if (open) load().catch((e) => setErr(e.message)); }, [open, load]);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };

  if (!open) return <button className="link" onClick={() => setOpen(true)} aria-label="Show whether this client's Kora books are linked">Their books</button>;
  return (
    <div style={{ fontSize: 13 }}>
      {err && <p className="error" role="alert">{err}</p>}
      {link?.status === 'none' && (
        <>
          <p className="muted">Not linked. If this client uses Kora, you can read their dashboard and GSTR-2B differences once their owner agrees.</p>
          {wide && <button className="secondary" onClick={() => run(async () => { const r = await api<{ code: string }>(`/api/ca/clients/${clientId}/link`, { body: {} }); setCode(r.code); })}>Ask to link</button>}
        </>
      )}
      {code && <p role="status">Give this code to the owner of their Kora business (shown once, valid 7 days): <b style={{ fontSize: 16, letterSpacing: 1 }}>{code}</b><br /><span className="muted">They enter it under Accounting firms in their Kora.</span></p>}
      {link?.status === 'pending' && !code && <p className="muted">Waiting for their owner to enter the code (valid until {link.expiresAt?.slice(0, 10)}). <button className="link" onClick={() => run(() => api(`/api/ca/clients/${clientId}/link`, { method: 'DELETE' }))}>Cancel</button></p>}
      {link?.status === 'active' && (
        <>
          <p><span className="chip paid">Linked</span> You can read this business (read only).{' '}
            {wide && <button className="link" onClick={() => { if (window.confirm('Stop reading this client\'s books? You can ask to link again later.')) void run(() => api(`/api/ca/clients/${clientId}/link`, { method: 'DELETE' })); }}>Stop</button>}</p>
          {summary && <p>Owed to them: <b>{rupees(summary.owed.outstanding)}</b> · Overdue: <b>{rupees(summary.owed.overdue)}</b> ({summary.owed.overdueCount}) · Drafts: <b>{summary.attention.drafts}</b></p>}
          {recon && (recon.loaded > 0 || recon.onlyInBooks > 0) ? (
            <p>GSTR-2B for {recon.period}: <b>{recon.matched}</b> match · <b className={recon.mismatched ? 'error' : undefined}>{recon.mismatched}</b> differ in amount · <b className={recon.onlyIn2b ? 'error' : undefined}>{recon.onlyIn2b}</b> only in 2B · <b className={recon.onlyInBooks ? 'error' : undefined}>{recon.onlyInBooks}</b> only in their books.
              <br /><span className="muted">As the business last matched them. Kora does not match on your behalf.</span></p>
          ) : <p className="muted">No GSTR-2B for {recon?.period ?? 'last month'} has been loaded in their books yet.</p>}
        </>
      )}
      <button className="link" onClick={() => setOpen(false)}>Hide</button>
    </div>
  );
}
