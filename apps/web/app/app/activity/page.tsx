'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/client';
import EmptyState from '../../../components/EmptyState';

type Entry = { id: string; at: string; actor: string | null; table_name: string; row_id: string | null; action: string; before: any; after: any };
const NAMES: Record<string, string> = { document: 'Document', payment: 'Payment', payment_allocation: 'Payment applied', party: 'Customer', item: 'Item', member: 'Team', business: 'Business',
  number_series: 'Numbering', einvoice: 'E-invoice', payment_link: 'Payment link', document_template: 'Template', eway_bill: 'E-way bill', recurring_schedule: 'Recurring' };

export default function Activity() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [table, setTable] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/api/audit?limit=200${table ? `&table=${table}` : ''}`).then((r) => setRows(r.entries)).catch((e) => setErr(e.message)); }, [table]);

  return (
    <>
      <h1>Activity</h1>
      <p className="muted">Every change to your records, who made it, and when. It cannot be edited or deleted.</p>
      <label htmlFor="at">Show</label>
      <select id="at" style={{ maxWidth: 260 }} value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">Everything</option>{Object.entries(NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {err && <p className="error" role="alert">{err}</p>}
      {rows && rows.length === 0 && <EmptyState icon="clock" title="No activity yet">Every change to your invoices, customers and settings is recorded here as you work. Make an invoice and it will show up.</EmptyState>}
      {rows && rows.length > 0 && (
        <table className="t" style={{ marginTop: 12 }}>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.at).toLocaleString('en-IN')}</td><td>{r.actor ?? 'Unknown'}</td>
              <td>{NAMES[r.table_name] ?? r.table_name} {r.action === 'INSERT' ? 'created' : r.action === 'UPDATE' ? 'changed' : 'deleted'}
                {open === r.id && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '8px 0 0' }}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>}</td>
              <td className="n"><button className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button></td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
