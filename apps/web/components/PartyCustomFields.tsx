'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';
import CustomFieldInputs, { type CustomDef } from './CustomFieldInputs';

/** The custom answers kept on one customer. They are copied onto each document made for them when it is issued. */
export default function PartyCustomFields({ partyId, name, canWrite, onClose }: { partyId: string; name: string; canWrite: boolean; onClose: () => void }) {
  const [defs, setDefs] = useState<CustomDef[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    Promise.all([api('/api/custom-fields?entity=customer'), api(`/api/parties/${partyId}/custom`)]).then(([d, v]) => {
      setDefs(d.fields);
      setValues(Object.fromEntries((v.values as { id: string; value: string }[]).map((x) => [x.id, x.value])));
    }).catch((e) => setErr(e.message));
  }, [partyId]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api(`/api/parties/${partyId}/custom`, { method: 'PUT', body: { values } }); setMsg('Saved.'); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="panel" onSubmit={save} aria-label={`Custom fields for ${name}`} data-testid="party-fields">
      <div className="toolbar" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Custom fields: {name}</h2><button type="button" className="secondary" onClick={onClose}>Close</button></div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {defs && defs.length === 0 && <p className="muted">You have not added any customer fields yet. Add them under Settings, Custom fields.</p>}
      {defs && defs.length > 0 && <CustomFieldInputs defs={defs} values={values} onChange={setValues} idPrefix="pf" disabled={!canWrite} />}
      {defs && defs.length > 0 && canWrite && <button>Save</button>}
    </form>
  );
}
