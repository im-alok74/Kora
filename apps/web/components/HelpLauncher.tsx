'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import '../app/wizard.css';

const TOUR: { title: string; text: string; href: string; link: string }[] = [
  { title: 'Dashboard', text: 'What you are owed, what is overdue, and a short list of what needs you today.', href: '/app', link: 'Open the dashboard' },
  { title: 'Documents', text: 'Every invoice, quote and credit note. Make a new one here, and open any to send it or record a payment.', href: '/app/invoices', link: 'Open documents' },
  { title: 'Customers and items', text: 'Save the people you bill and what you sell once. Invoices then fill in tax details for you.', href: '/app/customers', link: 'Open customers' },
  { title: 'Reports', text: 'Sales, ageing, GST summary and the GSTR-1 file for your CA.', href: '/app/reports', link: 'Open reports' },
  { title: 'Data and import', text: 'Bring in customers, items and invoices from other software, or take a full backup.', href: '/app/import', link: 'Open import' },
  { title: 'Settings', text: 'Your address, UPI ID, invoice look, reminders and more.', href: '/app/settings', link: 'Open settings' },
  { title: 'Help any time', text: 'The Help button on every screen opens short guides in plain words. You can also take this tour again from there.', href: '/help', link: 'Open the help centre' },
];

/** A Help button on every screen: search, the guides, and a short tour of the main screens. */
export default function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { if (!localStorage.getItem('kora-tour-seen') && window.location.pathname === '/app/welcome') return; } catch { /* storage may be blocked */ }
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setTour(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  useEffect(() => { if (open || tour !== null) closeRef.current?.focus(); }, [open, tour]);
  const endTour = () => { setTour(null); try { localStorage.setItem('kora-tour-seen', '1'); } catch { /* ignore */ } };

  return (
    <>
      <button type="button" className="help-fab" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><span aria-hidden="true">?</span> Help</button>
      {open && tour === null && (
        <div className="help-pop" role="dialog" aria-label="Help">
          <div className="hp-head"><b>How can we help?</b><button ref={closeRef} type="button" className="hp-x" aria-label="Close help" onClick={() => setOpen(false)}>×</button></div>
          <form action="/help" method="get" target="_blank" role="search">
            <label htmlFor="hq2" className="sr-only">Search help</label>
            <input id="hq2" name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guides" autoComplete="off" />
          </form>
          <ul>
            <li><a href="/help/first-invoice" target="_blank" rel="noopener">Make your first invoice</a></li>
            <li><a href="/help/gst-basics-for-invoices" target="_blank" rel="noopener">GST basics for your invoices</a></li>
            <li><a href="/help/payment-reminders" target="_blank" rel="noopener">Payment reminders</a></li>
            <li><a href="/help" target="_blank" rel="noopener">All help guides</a></li>
            <li><button type="button" className="link" onClick={() => { setTour(0); }}>Take a tour of the screens</button></li>
          </ul>
        </div>
      )}
      {tour !== null && (
        <div className="help-pop tour" role="dialog" aria-modal="true" aria-label="Tour of Kora">
          <div className="hp-head"><b>Step {tour + 1} of {TOUR.length}: {TOUR[tour]!.title}</b><button ref={closeRef} type="button" className="hp-x" aria-label="End tour" onClick={endTour}>×</button></div>
          <p>{TOUR[tour]!.text}</p>
          <p><a href={TOUR[tour]!.href}>{TOUR[tour]!.link}</a></p>
          <div className="hp-nav">
            <button type="button" className="secondary" disabled={tour === 0} onClick={() => setTour(tour - 1)}>Back</button>
            {tour < TOUR.length - 1 ? <button type="button" onClick={() => setTour(tour + 1)}>Next</button> : <button type="button" onClick={endTour}>Done</button>}
          </div>
        </div>
      )}
    </>
  );
}

/** A banner on every screen while you are in a sample business, with a one-click way to remove it. */
export function DemoBanner() {
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/demo').then((r) => setDemo(!!r.isDemo)).catch(() => {}); }, []);
  if (!demo) return null;
  return (
    <div className="demo-banner" role="status">
      <span><b>Sample data.</b> You are looking at a demo business with made-up customers and invoices. Nothing here is real, and nothing is sent to anyone.</span>
      <button type="button" disabled={busy} onClick={async () => {
        if (!window.confirm('Remove the sample business? You will not be able to open it again, but you can always make a new one.')) return;
        setBusy(true); setErr('');
        try { await api('/api/demo/remove', { body: {} }); window.location.href = '/app'; } catch (e) { setErr((e as Error).message); setBusy(false); }
      }}>Remove sample data</button>
      {err && <span role="alert">{err}</span>}
    </div>
  );
}
