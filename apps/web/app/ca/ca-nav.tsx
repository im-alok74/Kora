'use client';
import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import KoraLogo from '../../components/KoraLogo';
import Icon from '../../components/Icon';

export default function CaNav({ firmName, role, children }: { firmName: string; role: string; children: ReactNode }) {
  const path = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const items = [{ href: '/ca', label: 'Work', icon: 'briefcase' as const }, { href: '/ca/clients', label: 'Clients', icon: 'team' as const }, { href: '/app', label: 'Your books', icon: 'home' as const }];
  const current = (h: string) => (h === '/ca' ? path === '/ca' : path.startsWith(h));
  return (
    <>
      <div className="mobile-bar">
        <a className="brand" href="/ca" aria-label="Kora home"><KoraLogo /></a>
        <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'menu'} /></button>
      </div>
      <nav className="side" id="main-nav" aria-label="Main" data-open={open}>
        <a className="brand" href="/ca" aria-label="Kora home"><KoraLogo /></a>
        <div role="group" aria-label="Firm">
          <div className="nav-group" aria-hidden="true">{firmName}</div>
          {items.map((i) => <a key={i.href} className="nav" href={i.href} aria-current={current(i.href) ? 'page' : undefined}><Icon name={i.icon} size={19} />{i.label}</a>)}
        </div>
        <div className="who">{role && <span className="role">{role}</span>}{children}</div>
      </nav>
    </>
  );
}
