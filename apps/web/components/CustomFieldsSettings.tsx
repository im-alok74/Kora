'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/client';
import type { CustomDef } from './CustomFieldInputs';

const KIND: Record<string, string> = { text: 'Text', number: 'Number', date: 'Date', dropdown: 'List of choices' };

/** The fields a business adds to its documents and customers. Each can print on the PDF. */
export default function CustomFieldsSettings({ readOnly }: { readOnly: boolean }) {
  const [defs, setDefs] = useState<CustomDef[] | null>(null);
  const [f, setF] = useState({ entity: 'document', label: '', kind: 'text', options: '', showOnPdf: true });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/custom-fields').then((r) => setDefs(r.fields)).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api('/api/custom-fields', { body: { entity: f.entity, label: f.label, kind: f.kind, showOnPdf: f.showOnPdf, options: f.kind === 'dropdown' ? f.options.split(',') : undefined } });
      setF({ ...f, label: '', options: '' }); setMsg('Field added.'); await load();
    } catch (x) { setErr((x as Error).message); }
  };

  return (
    <div className="panel" aria-label="Custom fields">
      <h2>Custom fields</h2>
      <p className="muted">Add your own boxes to documents and customers, such as a project code or a vendor number. Turn on printing to show them on the PDF.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {defs && defs.length > 0 && (
        <table className="t" aria-label="Your custom fields">
          <thead><tr><th>Name</th><th>On</th><th>Kind</th><th>Prints</th><th /></tr></thead>
          <tbody>{defs.map((d) => (
            <tr key={d.id}><td>{d.label}</td><td>{d.entity === 'document' ? 'Documents' : 'Customers'}</td>
              <td>{KIND[d.kind]}{d.options ? `: ${d.options.join(', ')}` : ''}</td><td>{d.show_on_pdf ? 'Yes' : 'No'}</td>
              <td className="n">{!readOnly && <button type="button" className="link" aria-label={`Remove ${d.label}`} onClick={async () => { try { await api(`/api/custom-fields/${d.id}`, { method: 'DELETE' }); await load(); } catch (x) { setErr((x as Error).message); } }}>Remove</button>}</td></tr>))}</tbody>
        </table>)}
      {!readOnly && (
        <form onSubmit={add}>
          <div className="row">
            <div><label htmlFor="cf-on">Add it to</label>
              <select id="cf-on" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="document">Documents</option><option value="customer">Customers</option></select></div>
            <div><label htmlFor="cf-name">Name</label><input id="cf-name" maxLength={40} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required placeholder="Project code" /></div>
            <div><label htmlFor="cf-kind">Kind</label>
              <select id="cf-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          {f.kind === 'dropdown' && (<><label htmlFor="cf-opts">Choices, separated by commas</label><input id="cf-opts" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder="Low, Medium, High" required /></>)}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', height: 'auto' }} checked={f.showOnPdf} onChange={(e) => setF({ ...f, showOnPdf: e.target.checked })} /> Print it on the PDF</label>
          <button>Add field</button>
        </form>)}
    </div>
  );
}
