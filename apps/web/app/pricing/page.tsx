import type { Metadata } from 'next';
import { MarketingPage } from '../../components/SiteChrome';
import '../landing.css';
import '../landing-dark.css';
import '../site.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Three plans for Kora, from a free start to a plan for CA firms. Prices on this page are placeholders while Kora is in early access.',
  alternates: { canonical: '/pricing' },
};

type Plan = { name: string; forWho: string; price: string; per: string; features: string[]; cta: string; featured?: boolean };

// Placeholder prices. Replace before launch. Nothing on this page is a legal promise.
const PLANS: Plan[] = [
  { name: 'Starter', forWho: 'Freelancers and very small businesses just beginning.', price: 'Rs 0', per: 'a month', cta: 'Start free',
    features: ['One business, one person', 'A fixed number of invoices each month', 'GST tax worked out for you', 'UPI QR on every invoice', 'PDF and a shareable link', 'Import customers and items'] },
  { name: 'Business', forWho: 'Shops and growing businesses that bill every week.', price: 'Rs 499', per: 'a month', cta: 'Start free', featured: true,
    features: ['Everything in Starter', 'Unlimited invoices and quotes', 'WhatsApp, SMS and email sending', 'Payment reminders on a schedule', 'Recurring invoices', 'Up to 3 team members', 'Reports and GSTR-1 data for your CA'] },
  { name: 'Firm', forWho: 'CA firms, law practices and agencies with many clients.', price: 'Rs 1,999', per: 'a month', cta: 'Talk to us',
    features: ['Everything in Business', 'Many businesses under one login', 'One screen for every client', 'Matters, trust ledger and time tracking', 'More team members', 'Priority help by email'] },
];

const ROWS: [string, string, string, string][] = [
  ['Businesses', '1', '1', 'Many'],
  ['Invoices and quotes', 'Limited each month', 'Unlimited', 'Unlimited'],
  ['GST tax worked out for you', 'yes', 'yes', 'yes'],
  ['UPI QR and pay link', 'yes', 'yes', 'yes'],
  ['Send on WhatsApp, SMS and email', 'no', 'yes', 'yes'],
  ['Payment reminders', 'no', 'yes', 'yes'],
  ['Recurring invoices', 'no', 'yes', 'yes'],
  ['Team members', '1', 'Up to 3', 'More'],
  ['GSTR-1 data and GST summary', 'yes', 'yes', 'yes'],
  ['Clients screen for CA firms', 'no', 'no', 'yes'],
  ['Matters and trust ledger', 'no', 'no', 'yes'],
  ['Export and full backup', 'yes', 'yes', 'yes'],
];

const cell = (v: string) => v === 'yes'
  ? <td className="yes"><span aria-hidden="true">✓</span><span className="sr-only">Included</span></td>
  : v === 'no' ? <td className="no"><span aria-hidden="true">–</span><span className="sr-only">Not included</span></td>
  : <td>{v}</td>;

export default function Pricing() {
  return (
    <MarketingPage wide>
      <h1>Simple plans, in plain words</h1>
      <p className="lead">Start free. Move up when your business grows. No long contract and no setup fee.</p>
      <div className="draft-banner" role="note"><b>Placeholder prices.</b> Kora is in early access. The amounts below are examples so you can see how plans will look. They are not final and nothing is charged today.</div>

      <div className="plans">
        {PLANS.map((p) => (
          <section key={p.name} className={`plan${p.featured ? ' featured' : ''}`} aria-labelledby={`p-${p.name}`}>
            <h2 id={`p-${p.name}`}>{p.name}</h2>
            <p className="for">{p.forWho}</p>
            <p className="price">{p.price} <small>{p.per}</small></p>
            <span className="ph">Placeholder price</span>
            <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <a className={`btn${p.featured ? '' : ' secondary'}`} href="/login?signup=1">{p.cta}</a>
          </section>
        ))}
      </div>

      <h2>Compare the plans</h2>
      <div className="table-wrap" role="region" aria-label="Plan comparison" tabIndex={0}>
        <table className="cmp">
          <thead><tr><th scope="col">What you get</th>{PLANS.map((p) => <th scope="col" key={p.name}>{p.name}</th>)}</tr></thead>
          <tbody>{ROWS.map(([f, a, b, c]) => <tr key={f}><th scope="row">{f}</th>{cell(a)}{cell(b)}{cell(c)}</tr>)}</tbody>
        </table>
      </div>

      <h2>Questions about plans</h2>
      <h3>Do I need a card to start?</h3>
      <p>No. Starter is free and does not ask for a card.</p>
      <h3>Does Kora file my GST returns?</h3>
      <p>No. Kora prepares correct documents and return data. You and your CA remain responsible for every invoice and every filing.</p>
      <h3>Can I change plans later?</h3>
      <p>Yes. The final rules for changing or ending a plan will be written on the <a href="/refunds">refunds page</a> before any charge begins.</p>
    </MarketingPage>
  );
}
