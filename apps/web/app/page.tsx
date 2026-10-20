import type { Metadata } from 'next';
import Icon from '../components/Icon';

export const metadata: Metadata = {
  title: 'Kora: GST invoicing and collections for Indian businesses',
  description: 'Issue correct GST invoices, send them on WhatsApp, collect by UPI and keep your CA happy. Early access.',
};

const FEATURES: [React.ComponentProps<typeof Icon>['name'], string, string][] = [
  ['invoice', 'Invoices that are right the first time', 'CGST, SGST and IGST are worked out for you, in whole paise, from the place of supply. Numbers run in sequence for each financial year, and an issued invoice cannot be edited. Mistakes are fixed with credit and debit notes.'],
  ['rupee', 'Get paid faster', 'Every invoice carries a UPI QR for the amount still due. Send a payment link, take part payments, and let reminders go out on a schedule you choose. Payments match themselves to invoices.'],
  ['shield', 'E-invoicing without the guesswork', 'Kora checks the details the portal needs before sending, tells you in plain words what to fix, and keeps trying if the portal is down. You can cancel within the 24 hour window.'],
  ['phone', 'Works when the network does not', 'Install it on your phone. Draft invoices offline and they sync when you are back, with a clear prompt if something changed in between.'],
  ['chart', 'Ready for your CA', 'A GSTR-1 file and a GST summary that add up to your sales ledger to the paisa, a sales register, customer statements and an activity log nobody can edit.'],
  ['team', 'Built for a team', 'Owners, staff and accountants each see what they should. Run more than one business from one login.'],
];

const SEGMENTS: [React.ComponentProps<typeof Icon>['name'], string, string][] = [
  ['team', 'CA firms', 'See every client on one screen, with what is overdue and what is due. Collect documents through an inbox, match purchases to GSTR-2B and keep input credit clean, and jump into any client in one click.'],
  ['briefcase', 'Lawyers', 'Matters with fees, hearing dates and notes. Hold client money in trust and pay invoices from it, with a ledger that shows where every rupee came from. Make a matter private to the people on it.'],
  ['clock', 'Freelancers', 'Projects with a timer and a rate. Turn tracked hours into an invoice, send a pay link and let the reminders chase for you.'],
  ['cart', 'Shops', 'A till that scans barcodes, prints an 80 mm receipt and keeps stock right. Prices can include tax, and bills come out in English, Hindi, Marathi or Gujarati.'],
  ['database', 'Businesses that trade together', 'Send an invoice to a customer who is on Kora and it lands in their account, ready to become a purchase bill. Find suppliers in a directory, browse their catalogue and send purchase orders.'],
];

const STEPS: [string, string][] = [
  ['Add your business', 'Your GSTIN, address and the state you supply from. Takes a minute.'],
  ['Create an invoice', 'Pick a customer, add lines, and watch the tax work itself out. Save a draft or issue it.'],
  ['Send and collect', 'Share on WhatsApp, SMS or email with a pay link and a UPI QR. See who owes you, and by how much.'],
];

const FACTS: [string, string][] = [
  ['Paise-exact', 'Every amount is a whole number of paise. Totals never drift by a rupee.'],
  ['Gapless numbers', 'Invoice numbers run in order for each financial year, with no holes.'],
  ['Sealed once issued', 'An issued invoice and the activity log cannot be edited or deleted.'],
  ['Separate by design', 'The database itself keeps each business apart from every other.'],
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-bar">
        <a className="l-brand" href="/" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a>
        <nav aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#who">Who it is for</a>
          <a href="#how">How it works</a>
          <a href="#trust">Your CA and Kora</a>
          <a className="btn secondary" href="/login">Sign in</a>
        </nav>
      </header>

      <main className="l-main">
        <section className="l-hero">
          <div>
            <p className="l-eyebrow">Early access</p>
            <h1>GST invoicing that <em>gets you paid</em></h1>
            <p className="l-lead">Kora helps small Indian businesses issue correct GST invoices, send them on WhatsApp, collect by UPI and hand clean numbers to their CA.</p>
            <div className="l-cta">
              <a className="btn" href="/login">Sign in to Kora</a>
              <a className="btn secondary" href="#features">See what it does</a>
            </div>
            <p className="l-note">Sign in with a mobile number or email. No password to remember.</p>
            <ul className="l-points">
              <li><Icon name="check" size={18} />Tax worked out from the place of supply</li>
              <li><Icon name="check" size={18} />A UPI QR on every invoice</li>
              <li><Icon name="check" size={18} />GSTR-1 and GSTR-3B data for your CA</li>
            </ul>
          </div>

          <div className="l-demo" aria-hidden="true">
            <div className="l-badge wa"><Icon name="chat" size={16} />Sent on WhatsApp</div>
            <div className="l-sheet">
              <div className="top">
                <p className="who"><b>Your Business Name</b><br />Your address, your GSTIN</p>
                <div className="title">TAX INVOICE</div>
              </div>
              <table>
                <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">GST</th></tr></thead>
                <tbody>
                  <tr><td>Monthly retainer</td><td className="n">1</td><td className="n">12,000.00</td><td className="n">18%</td></tr>
                  <tr><td>Cabling work</td><td className="n">1</td><td className="n">4,500.00</td><td className="n">18%</td></tr>
                </tbody>
              </table>
              <div className="sum">
                <div><span>Taxable value</span><span>16,500.00</span></div>
                <div><span>IGST 18%</span><span>2,970.00</span></div>
                <div className="g"><span>Total</span><span>Rs 19,470.00</span></div>
              </div>
              <div className="foot"><span className="l-qr" /><span className="who">Scan to pay by UPI<br />The amount is filled in for you</span></div>
            </div>
            <div className="l-badge paid"><Icon name="check" size={16} />Payment matched</div>
          </div>
        </section>

        <section id="features" className="l-section" aria-labelledby="f-h">
          <h2 id="f-h">Everything an invoice needs, nothing it does not</h2>
          <p className="l-sub">Quotes, invoices, payments, reminders and returns data, in one place that stays correct.</p>
          <div className="l-grid">
            {FEATURES.map(([ic, t, d]) => (
              <article key={t} className="l-card"><div className="ico"><Icon name={ic} size={22} /></div><h3>{t}</h3><p>{d}</p></article>
            ))}
          </div>
        </section>

        <section id="who" className="l-section" aria-labelledby="w-h">
          <h2 id="w-h">One product, whoever you bill</h2>
          <p className="l-sub">The same careful invoicing underneath, with the tools your kind of work needs on top.</p>
          <div className="l-grid">
            {SEGMENTS.map(([ic, t, d]) => (
              <article key={t} className="l-card"><div className="ico"><Icon name={ic} size={22} /></div><h3>{t}</h3><p>{d}</p></article>
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

        <div className="l-band" role="list" aria-label="What Kora guarantees">
          {FACTS.map(([t, d]) => (
            <div key={t} role="listitem"><b>{t}</b><span>{d}</span></div>
          ))}
        </div>

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
        <span><a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a></span>
      </footer>
    </div>
  );
}
