'use client';

import { useEffect } from 'react';

/**
 * On a narrow screen a wide table scrolls sideways. A scrolling area has to be reachable by keyboard (WCAG 2.1.1) and named,
 * so every table that actually overflows gets tabindex 0, a region role and a label taken from the table or its heading.
 */
export default function ScrollableTables() {
  useEffect(() => {
    const mark = () => {
      document.querySelectorAll<HTMLTableElement>('table.t').forEach((t) => {
        if (t.scrollWidth > t.clientWidth + 1) {
          t.tabIndex = 0;
          t.setAttribute('role', 'region');
          if (!t.getAttribute('aria-label')) {
            const h = t.closest('section, .card, main')?.querySelector('h2, h3, h1')?.textContent?.trim();
            t.setAttribute('aria-label', h ? `${h}, table` : 'Table');
          }
        } else if (t.getAttribute('role') === 'region') {
          t.removeAttribute('tabindex');
          t.removeAttribute('role');
        }
      });
    };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', mark);
    return () => { mo.disconnect(); window.removeEventListener('resize', mark); };
  }, []);
  return null;
}
