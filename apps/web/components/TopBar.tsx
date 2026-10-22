'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from '../lib/client';

type Hit = { kind: string; id: string; title: string; subtitle: string; href: string };
type Notice = { id: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; href: string };

const KIND_LABEL: Record<string, string> = { document: 'Documents', customer: 'Customers and vendors', item: 'Items', matter: 'Matters', bill: 'Purchase bills', expense: 'Expenses' };
const QUICK: { label: string; href: string; hint: string }[] = [
  { label: 'New invoice', href: '/app/invoices/new', hint: 'Create' }, { label: 'New estimate', href: '/app/invoices/new?type=estimate', hint: 'Create' },
  { label: 'Documents', href: '/app/invoices', hint: 'Go to' }, { label: 'Customers', href: '/app/customers', hint: 'Go to' }, { label: 'Items', href: '/app/items', hint: 'Go to' },
  { label: 'Purchases', href: '/app/purchases', hint: 'Go to' }, { label: 'Expenses', href: '/app/expenses', hint: 'Go to' }, { label: 'Reports', href: '/app/reports', hint: 'Go to' },
  { label: 'Settings', href: '/app/settings', hint: 'Go to' }, { label: 'Security', href: '/app/security', hint: 'Go to' },
];

function useDismissed(): [Set<string>, (id: string) => void, () => void] {
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => { try { setSet(new Set(JSON.parse(localStorage.getItem('kora-dismissed') ?? '[]'))); } catch { /* storage unavailable */ } }, []);
  const save = (s: Set<string>) => { setSet(s); try { localStorage.setItem('kora-dismissed', JSON.stringify([...s].slice(-200))); } catch { /* ignore */ } };
  return [set, (id) => save(new Set(set).add(id)), () => save(new Set())];
}

/** Search (Ctrl or Cmd + K, or /), the list of what needs attention, and the light and dark switch. */
export default function TopBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const [notices, setNotices] = useState<Notice[]>([]);
  const [bell, setBell] = useState(false);
  const [dismissed, dismiss, restore] = useDismissed();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => { api('/api/notifications').then((r) => setNotices(r.notices)).catch(() => {}); }, []);

  const show = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); setQ(''); setHits([]); setCur(0); }, []);
  const hide = useCallback(() => { setOpen(false); opener.current?.focus?.(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open ? hide() : show(); }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); show(); }
      else if (e.key === 'Escape') { if (open) hide(); setBell(false); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, show, hide]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    setBusy(true);
    const h = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(term)}`).then((r) => { setHits(r.hits); setCur(0); }).catch(() => setHits([])).finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(h);
  }, [q, open]);

  const items = q.trim().length >= 2 ? hits.map((h) => ({ key: `${h.kind}:${h.id}`, title: h.title, sub: h.subtitle, href: h.href, group: KIND_LABEL[h.kind] ?? h.kind }))
    : QUICK.map((x) => ({ key: x.href, title: x.label, sub: x.hint, href: x.href, group: 'Quick actions' }));
  const go = (href: string) => { window.location.href = href; };

  const live = notices.filter((n) => !dismissed.has(n.id));
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; setDark(!dark);
    try { localStorage.setItem('kora-theme', next); } catch { /* ignore */ }
  };

  return (
    <div className="topbar">
      <button type="button" className="searchbtn" onClick={show} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" size={17} /><span>Search</span><kbd aria-hidden="true">Ctrl K</kbd>
      </button>
      <div className="topbar-right">
        <div className="bellwrap">
          <button type="button" className="iconbtn" onClick={() => setBell((v) => !v)} aria-label={live.length ? `Notifications, ${live.length} to look at` : 'Notifications'} aria-expanded={bell} aria-haspopup="true">
            <Icon name="bell" size={19} />{live.length > 0 && <span className="badge" aria-hidden="true">{live.length > 9 ? '9+' : live.length}</span>}
          </button>
          {bell && (
            <div className="popover" role="region" aria-label="Notifications">
              <div className="popover-head"><b>Needs your attention</b>{dismissed.size > 0 && <button type="button" className="link" onClick={restore}>Show dismissed</button>}</div>
              {live.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>Nothing needs you right now.</p> : (
                <ul>{live.map((n) => (
                  <li key={n.id} className={`notice ${n.severity}`}>
                    <a href={n.href}><b>{n.title}</b><span>{n.detail}</span></a>
                    <button type="button" className="iconbtn sm" aria-label={`Dismiss: ${n.title}`} onClick={() => dismiss(n.id)}><Icon name="close" size={15} /></button>
                  </li>))}</ul>)}
            </div>)}
        </div>
        <button type="button" className="iconbtn" onClick={() => window.dispatchEvent(new Event('kora:help'))} aria-label="Keyboard shortcuts and help"><span aria-hidden="true" style={{ fontWeight: 700 }}>?</span></button>
        <button type="button" className="iconbtn" onClick={toggleTheme} aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'} aria-pressed={dark}><Icon name={dark ? 'sun' : 'moon'} size={19} /></button>
      </div>

      {open && (
        <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
          <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, customers, items, bills" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[cur] ? `pi-${cur}` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(items.length - 1, c + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
                else if (e.key === 'Enter' && items[cur]) { e.preventDefault(); go(items[cur]!.href); }
              }} />
            <ul id="palette-list" role="listbox" aria-label="Results">
              {items.map((it, i) => (
                <li key={it.key} id={`pi-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => go(it.href)}>
                  {(i === 0 || items[i - 1]!.group !== it.group) && <div className="grp">{it.group}</div>}
                  <div className="row2"><b>{it.title}</b><span>{it.sub}</span></div>
                </li>))}
              {q.trim().length >= 2 && !busy && items.length === 0 && <li className="none" role="presentation">Nothing found for &ldquo;{q.trim()}&rdquo;.</li>}
              {busy && <li className="none" role="presentation">Searching</li>}
            </ul>
            <div className="palette-foot"><span><kbd>Up</kbd> <kbd>Down</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
          </div>
        </div>)}
    </div>
  );
}
