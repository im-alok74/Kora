import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAdminUser } from '@kora/core';
import { currentSessionToken, currentUserId, services } from '../../lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Admin', template: '%s | Kora admin' }, robots: { index: false, follow: false } };

/** Staff only. A visitor who is not an admin, or who signed in without an authenticator code, sees the ordinary 404 page. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [userId, token] = [await currentUserId(), await currentSessionToken()];
  if (!userId || !token) notFound();
  const svc = services();
  if (!(await isAdminUser(svc.sql, userId)) || !(await svc.auth.sessionHasMfa(token))) notFound();
  return <main style={{ maxWidth: 1180, margin: '0 auto', padding: '16px' }}>{children}</main>;
}
