import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { listBusinesses } from '@kora/core';
import { BUSINESS_COOKIE, currentUserId, services } from '../../lib/server';
import SignOut from './sign-out';
import ClientOnly from '../../components/ClientOnly';
import BusinessSwitcher from './business-switcher';
import SyncStatus from '../../components/SyncStatus';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const businesses = await listBusinesses(services().sql, userId);
  if (businesses.length === 0) redirect('/setup');
  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const active = businesses.find((b) => b.businessId === chosen) ?? businesses[0]!;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">kora</div>
        <a className="nav" href="/app/invoices">Documents</a>
        <a className="nav" href="/app/customers">Customers</a>
        <a className="nav" href="/app/items">Items</a>
        <a className="nav" href="/app/reports">Reports</a>
        {active.role === 'owner' && <a className="nav" href="/app/team">Team</a>}
        {active.role !== 'staff' && <a className="nav" href="/app/activity">Activity</a>}
        <a className="nav" href="/app/settings">Settings</a>
        <div className="who">
          <BusinessSwitcher businesses={businesses} activeId={active.businessId} />
          <div className="muted" style={{ marginTop: 4 }}>{active.role}</div>
          <SignOut />
        </div>
      </nav>
      <div className="content"><ClientOnly><SyncStatus />{children}</ClientOnly></div>
    </div>
  );
}
