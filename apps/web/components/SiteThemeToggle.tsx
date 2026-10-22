'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';

export default function SiteThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setDark(next === 'dark');
    try { localStorage.setItem('kora-theme', next); } catch { /* The theme still works without storage. */ }
  }

  return <button type="button" className="site-theme-toggle" onClick={toggle} aria-label="Dark mode" aria-pressed={dark}>
    <Icon name={dark ? 'sun' : 'moon'} size={17} /><span>{dark ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}
