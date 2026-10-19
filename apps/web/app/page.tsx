import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kora: GST invoicing and collections for Indian businesses',
  description: 'Issue correct GST invoices, send them on WhatsApp, collect by UPI and keep your CA happy. Early access.',
};

const FEATURES: [string, string][] = [
  ['Invoices that are right the first time', 'CGST, SGST and IGST are worked out for you, in whole paise, from the place of supply. Numbers run in sequence for each financial year, and an issued invoice cannot be edited. Mistakes are fixed with credit and debit notes.'],
  ['Get paid faster', 'Every invoice carries a UPI QR for the amount still due. Send a payment link, take part payments, and let reminders go out on a schedule you choose. Payments match themselves to invoices.'],
  ['E-invoicing without the guesswork', 'Kora checks the details the portal needs before sending, tells you in plain words what to fix, and keeps trying if the portal is down. You can cancel within the 24 hour window.'],
  ['Works when the network does not', 'Install it on your phone. Draft invoices offline and they sync when you are back, with a clear prompt if something changed in between.'],
  ['Ready for your CA', 'A GSTR-1 file and a GST summary that add up to your sales ledger to the paisa, a sales register, customer statements and an activity log nobody can edit.'],
  ['Built for a team', 'Owners, staff and accountants each see what they should. Run more than one business from one login.'],
];

const STEPS: [string, string][] = [
  ['Add your business', 'Your GSTIN, address and the state you supply from. Takes a minute.'],
  ['Create an invoice', 'Pick a customer, add lines, and watch the tax work itself out. Save a draft or issue it.'],
  ['Send and collect', 'Share on WhatsApp, SMS or email with a pay link and a UPI QR. See who owes you, and by how much.'],
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-bar">
        <a className="l-brand" href="/" aria-label="Kora home">kora</a>
        <nav aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#trust">Your CA and Kora</a>
          <a className="btn secondary" href="/login">Sign in</a>
        </nav>
      </header>

      <main className="l-main">
        <section className="l-hero">
          <p className="l-eyebrow">Early access</p>
          <h1>GST invoicing that gets you paid</h1>
          <p className="l-lead">Kora helps small Indian businesses issue correct GST invoices, send them on WhatsApp, collect by UPI and hand clean numbers to their CA.</p>
          <div className="l-cta">
            <a className="btn" href="/login">Sign in to Kora</a>
            <a className="btn secondary" href="#features">See what it does</a>
          </div>
          <p className="l-note">Sign in with a mobile number or email. No password to remember.</p>
        </section>

        <section id="features" className="l-section" aria-labelledby="f-h">
          <h2 id="f-h">Everything an invoice needs, nothing it does not</h2>
          <div className="l-grid">
            {FEATURES.map(([t, d]) => (
              <article key={t} className="l-card"><h3>{t}</h3><p>{d}</p></article>
            ))}
          </div>
        </section>

        <section id="how" className="l-section" aria-labelledby="h-h">
          <h2 id="h-h">From first login to first payment</h2>
          <ol className="l-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="l-num" aria-hidden="true">{i + 1}</span><div><h3>{t}</h3><p>{d}</p></div></li>
            ))}
          </ol>
        </section>

        <section id="trust" className="l-section l-trust" aria-labelledby="t-h">
          <h2 id="t-h">Built to be run with your CA</h2>
          <p>Kora prepares correct documents and return data. You, with your CA, remain responsible for every invoice and every filing. Kora does not file returns for you.</p>
          <ul>
            <li>Your data stays in a database that separates every business from every other, enforced by the database itself.</li>
            <li>Issued invoices and the activity log cannot be changed or deleted.</li>
            <li>We never ask for your GST portal password.</li>
          </ul>
          <p className="l-note">Kora is in early access. Some connections, such as WhatsApp delivery and live e-invoice registration, are being switched on with our partners.</p>
        </section>

        <section className="l-section l-final">
          <h2>Ready to try it?</h2>
          <a className="btn" href="/login">Sign in to Kora</a>
        </section>
      </main>

      <footer className="l-foot">
        <span>Kora</span>
        <span>GST invoicing and collections for Indian businesses</span>
      </footer>
    </div>
  );
}
