import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listFirms } from '@kora/core';
import { currentUserId, services } from '../../lib/server';
import SignOut from '../app/sign-out';
import CaNav from './ca-nav';
import CaSetup from './setup';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Your firm', template: '%s | Kora for CAs' }, robots: { index: false, follow: false } };

/** The CA firm workspace. It is separate from /app because a firm does not need a Kora business of its own. */
export default async function CaLayout({ children }: { children: ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const firms = await listFirms(services().sql, userId);
  const firm = firms[0];
  return (
    <div className="shell">
      <CaNav firmName={firm?.name ?? 'Kora for CAs'} role={firm?.role ?? ''}><SignOut /></CaNav>
      <div className="content"><div role="main" id="main-content" className="app-page">{firm ? children : <CaSetup />}</div></div>
    </div>
  );
}
