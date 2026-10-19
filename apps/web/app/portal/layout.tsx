import type { ReactNode } from 'react';

// Private to one customer: never listed by search engines.
export const metadata = { title: 'Your account', robots: { index: false, follow: false } };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
