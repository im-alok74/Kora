import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { listBusinesses } from '@kora/core';
import { BUSINESS_COOKIE, currentUserId, services } from '../../lib/server';
import SideNav from './side-nav';
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
      <SideNav role={active.role}>
        <BusinessSwitcher businesses={businesses} activeId={active.businessId} />
        <span className="role">{active.role}</span>
        <SignOut />
      </SideNav>
      <div className="content"><ClientOnly><SyncStatus />{children}</ClientOnly></div>
    </div>
  );
}
