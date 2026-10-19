'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Icon, { type IconName } from '../../components/Icon';

type Item = { href: string; label: string; icon: IconName; show?: boolean };

/** The main navigation. On a phone it is a drawer behind a menu button. The page you are on is marked, for sighted users and screen readers. */
export default function SideNav({ role, multi = false, children }: { role: string; multi?: boolean; children: ReactNode }) {
  const path = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Overview', items: [{ href: '/app', label: 'Dashboard', icon: 'home' }, { href: '/app/firm', label: 'Clients', icon: 'team', show: multi }] },
    { title: 'Sales', items: [
      { href: '/app/invoices', label: 'Documents', icon: 'documents' }, { href: '/app/pos', label: 'Till', icon: 'rupee', show: role !== 'accountant' }, { href: '/app/recurring', label: 'Recurring', icon: 'repeat' },
      { href: '/app/matters', label: 'Matters', icon: 'briefcase' }, { href: '/app/projects', label: 'Projects', icon: 'clock' }, { href: '/app/customers', label: 'Customers', icon: 'user' }, { href: '/app/items', label: 'Items', icon: 'box' }] },
    { title: 'Money', items: [{ href: '/app/inbox', label: 'Inbox', icon: 'inbox' }, { href: '/app/purchases', label: 'Purchases', icon: 'cart' }, { href: '/app/itc', label: 'Input GST', icon: 'percent' }, { href: '/app/expenses', label: 'Expenses', icon: 'receipt' }, { href: '/app/reports', label: 'Reports', icon: 'chart' }] },
    { title: 'Manage', items: [
      { href: '/app/data', label: 'Data', icon: 'database' }, { href: '/app/developers', label: 'Developers', icon: 'code', show: role === 'owner' },
      { href: '/app/team', label: 'Team', icon: 'team', show: role === 'owner' }, { href: '/app/activity', label: 'Activity', icon: 'clock', show: role !== 'staff' },
      { href: '/app/security', label: 'Security', icon: 'shield' }, { href: '/app/security', label: 'Security', icon: 'shield' }, { href: '/app/settings', label: 'Settings', icon: 'settings' }] },
  ];
  const current = (href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(href + '/'));

  return (
    <>
      <div className="mobile-bar">
        <a className="brand" href="/app" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a>
        <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'menu'} /></button>
      </div>
      <div className="scrim" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />
      <nav className="side" id="main-nav" aria-label="Main" data-open={open}>
        <a className="brand" href="/app" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a>
        {groups.map((g) => {
          const items = g.items.filter((i) => i.show !== false);
          return (
            <div key={g.title} role="group" aria-label={g.title}>
              <div className="nav-group" aria-hidden="true">{g.title}</div>
              {items.map((i) => (
                <a key={i.href} className="nav" href={i.href} aria-current={current(i.href) ? 'page' : undefined}><Icon name={i.icon} size={19} />{i.label}</a>
              ))}
            </div>
          );
        })}
        <div className="who">{children}</div>
      </nav>
    </>
  );
}
