'use client';
import { useState } from 'react';
import { api } from '../../lib/client';

export default function CaSetup() {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('/api/ca/firm', { body: { name } }); window.location.reload(); } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <form className="panel" onSubmit={go} style={{ maxWidth: 520 }}>
      <h1>Set up your firm</h1>
      <p className="muted">You will be its partner. Next you add clients, then each month Kora lists the GST work to do for every one of them.</p>
      <label htmlFor="fn">Firm name</label>
      <input id="fn" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn" disabled={busy || !name.trim()}>Create firm</button>
    </form>
  );
}
