'use client';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renders its children only after the page has hydrated. These screens are forms driven by React state:
 * anything typed before hydration would be wiped, and the browser would submit the form natively.
 * On a slow phone that window is long enough to matter.
 */
export default function ClientOnly({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <>{children}</> : <p className="muted" aria-busy="true">Loading</p>;
}
