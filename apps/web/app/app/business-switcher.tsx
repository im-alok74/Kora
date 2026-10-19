'use client';
import { api } from '../../lib/client';

/** Several businesses under one login: choose one, or add another. */
export default function BusinessSwitcher({ businesses, activeId }: { businesses: { businessId: string; legalName: string }[]; activeId: string }) {
  return (
    <div>
      <label htmlFor="bs" style={{ marginTop: 0 }} className="muted">Business</label>
      <select id="bs" value={activeId} onChange={async (e) => {
        if (e.target.value === '__new') { window.location.href = '/setup?add=1'; return; }
        await api('/api/business/select', { body: { businessId: e.target.value } });
        window.location.href = '/app/invoices';
      }}>
        {businesses.map((b) => <option key={b.businessId} value={b.businessId}>{b.legalName}</option>)}
        <option value="__new">+ Add a business</option>
      </select>
    </div>
  );
}
