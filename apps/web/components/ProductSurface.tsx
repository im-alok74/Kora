'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** A short page entrance; forms and application state are never remounted. */
export default function ProductSurface({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) return;
    const animation = root.current?.animate([{ opacity: .4, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    const stop = () => { if (preference.matches) animation?.cancel(); };
    preference.addEventListener('change', stop);
    return () => { animation?.cancel(); preference.removeEventListener('change', stop); };
  }, [path]);
  return <div className="app-page" ref={root}>{children}</div>;
}
