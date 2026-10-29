import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { listFirmInvites, listFirms } from '@kora/core';
import { currentUserId, services } from '../../lib/server';
import SignOut from '../app/sign-out';
import CaNav from './ca-nav';
import CaSetup from './setup';
import Invites from './invites';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Your firm', template: '%s | Kora for CAs' }, robots: { index: false, follow: false } };

/** The CA firm workspace. It is separate from /app because a firm does not need a Kora business of its own. */
export default async function CaLayout({ children }: { children: ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const firms = await listFirms(services().sql, userId);
  const firm = firms[0];
  const invites = await listFirmInvites(services().sql, userId);
  return (
    <div className="shell">
      <CaNav firmName={firm?.name ?? 'Kora for CAs'} role={firm?.role ?? ''}><SignOut /></CaNav>
      <div className="content"><div role="main" id="main-content" className="app-page"><Invites invites={invites} />{firm ? children : <CaSetup />}</div></div>
    </div>
  );
}
