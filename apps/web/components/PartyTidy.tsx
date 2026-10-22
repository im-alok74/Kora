'use client';
import { useState } from 'react';
import { api } from '../lib/client';

type Group = { reason: string; parties: { id: string; kind: string; name: string; gstin: string | null; phone: string | null; email: string | null }[] };

/** Export the list, and find customers or vendors entered twice and fold them into one. */
export default function PartyTidy({ kind, canMerge, onMerged }: { kind: 'customer' | 'vendor'; canMerge: boolean; onMerged: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const find = async () => { setErr(''); setMsg(''); try { setGroups((await api('/api/parties/duplicates')).groups); } catch (e) { setErr((e as Error).message); } };
  const merge = async (keepId: string, dropId: string, names: string) => {
    if (!window.confirm(`Merge ${names}? The second record is archived and everything that can move goes to the first. This cannot be undone.`)) return;
    setErr(''); setMsg('');
    try { await api('/api/parties/merge', { body: { keepId, dropId } }); setMsg('Merged.'); onMerged(); await find(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <details className="panel" style={{ marginBottom: 12 }}>
      <summary>Export, import and tidy up</summary>
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <a className="btn secondary" style={{ flex: 'none' }} href={`/api/parties/export?format=csv&kind=${kind}`}>Export CSV</a>
        <a className="btn secondary" style={{ flex: 'none' }} href={`/api/parties/export?format=xlsx&kind=${kind}`}>Export Excel</a>
        <a className="btn secondary" style={{ flex: 'none' }} href="/app/data">Import from a file</a>
        <button type="button" className="secondary" style={{ flex: 'none' }} onClick={() => void find()}>Find duplicates</button>
      </div>
      {groups && groups.length === 0 && <p className="ok" role="status">No duplicates found.</p>}
      {groups?.map((g, i) => (
        <div key={i} className="panel" style={{ marginTop: 10 }}>
          <b>{g.reason}</b>
          <ul className="plain">{g.parties.map((p) => <li key={p.id}><span>{p.name}{p.gstin ? ` · ${p.gstin}` : ''}{p.phone ? ` · ${p.phone}` : ''}</span>
            {canMerge && g.parties.length === 2 && <button className="link" onClick={() => void merge(p.id, g.parties.find((o) => o.id !== p.id)!.id, `${g.parties.find((o) => o.id !== p.id)!.name} into ${p.name}`)}>Keep this one</button>}</li>)}</ul>
          {g.parties.length > 2 && <p className="muted">More than two look alike. Merge them two at a time.</p>}
        </div>))}
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </details>
  );
}
