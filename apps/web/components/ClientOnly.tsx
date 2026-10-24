'use client';
import { setOfflineScope, type OfflineScope } from '../lib/offlineScope';
import KoraLoader from './KoraLoader';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renders its children only after the page has hydrated. These screens are forms driven by React state:
 * anything typed before hydration would be wiped, and the browser would submit the form natively.
 * On a slow phone that window is long enough to matter.
 */
export default function ClientOnly({ children, offlineScope }: { children: ReactNode; offlineScope?: OfflineScope }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (offlineScope) setOfflineScope(offlineScope); setReady(true); }, [offlineScope]);
  return ready ? <>{children}</> : <KoraLoader />;
}
