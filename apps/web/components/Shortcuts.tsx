'use client';
import { useEffect, useRef, useState } from 'react';

/** Where each key goes. "g" then a letter follows the same pattern as the shortcuts in other business tools. */
export const GO_KEYS: [string, string, string][] = [
  ['d', 'Dashboard', '/app'], ['i', 'Documents', '/app/invoices'], ['c', 'Customers', '/app/customers'], ['t', 'Items', '/app/items'],
  ['p', 'Purchases', '/app/purchases'], ['b', 'Bank statement', '/app/bank'], ['r', 'Reports', '/app/reports'], ['s', 'Settings', '/app/settings'],
];

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) || e.isContentEditable);
};

/** Keyboard shortcuts for the signed-in app, and the help sheet that lists them. Open the sheet with ? or the help button. */
export default function Shortcuts() {
  const [open, setOpen] = useState(false);
  const pending = useRef<number | null>(null);          // set to a timer after "g", waiting for the letter
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = () => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (typing(e.target)) return;
      if (e.key === '?') { e.preventDefault(); if (open) setOpen(false); else show(); return; }
      if (pending.current !== null) {
        window.clearTimeout(pending.current); pending.current = null;
        const hit = GO_KEYS.find(([k]) => k === e.key.toLowerCase());
        if (hit) { e.preventDefault(); window.location.href = hit[2]; }
        return;
      }
      if (e.key === 'g') { pending.current = window.setTimeout(() => { pending.current = null; }, 1200); return; }
      if (e.key === 'n') { e.preventDefault(); window.location.href = '/app/invoices/new'; }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('kora:help', show);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('kora:help', show); if (pending.current !== null) window.clearTimeout(pending.current); };
  }, [open]);

  useEffect(() => {
    if (open) closeRef.current?.focus(); else opener.current?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div className="scrim-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-h">
        <div className="panel-head"><h2 id="help-h">Keyboard shortcuts</h2><button ref={closeRef} type="button" className="secondary sm" style={{ marginTop: 0 }} onClick={() => setOpen(false)}>Close</button></div>
        <p className="muted">Shortcuts work when you are not typing in a field.</p>
        <dl className="keys">
          <div><dt><kbd>n</kbd></dt><dd>New invoice</dd></div>
          <div><dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Search everything</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show this help</dd></div>
          {GO_KEYS.map(([k, label]) => <div key={k}><dt><kbd>g</kbd> then <kbd>{k}</kbd></dt><dd>Go to {label}</dd></div>)}
        </dl>
        <h3>Where things are</h3>
        <ul className="plain">
          <li><span>Your business details, default notes and terms</span><a href="/app/settings">Settings</a></li>
          <li><span>Record what the bank shows</span><a href="/app/bank">Bank statement</a></li>
          <li><span>Everything you can download</span><a href="/app/data">Data</a></li>
          <li><span>Connect other software</span><a href="/app/developers">Developers</a></li>
        </ul>
      </div>
    </div>
  );
}
