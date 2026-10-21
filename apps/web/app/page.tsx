import type { Metadata } from 'next';
import Icon from '../components/Icon';
import InvoiceShowcase from '../components/InvoiceShowcase';
import LandingMotion from '../components/LandingMotion';
import TemplateCarousel from '../components/TemplateCarousel';
import './landing.css';

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

const TILES: [string, React.ComponentProps<typeof Icon>['name'], string, string][] = [
  ['pink', 'percent', 'Tax works itself out', 'CGST, SGST or IGST from the place of supply, in whole paise.'],
  ['mint', 'qr', 'A UPI QR on every invoice', 'The amount still due is filled in, so paying takes one scan.'],
  ['sky', 'chat', 'Sent where customers are', 'Share on WhatsApp, SMS or email with a pay link.'],
  ['sun', 'chart', 'Ready for your CA', 'GSTR-1 data and a GST summary that match your sales ledger.'],
];

const TINTS = ['pink', 'mint', 'sky', 'sun'];

const FAQ: [string, string][] = [
  ['Does Kora file my GST returns?', 'No. Kora prepares correct documents and return data, such as a GSTR-1 file and a GST summary. You, with your CA, remain responsible for every invoice and every filing.'],
  ['Is my data kept apart from other businesses?', 'Yes. The database itself separates every business from every other, so one business cannot see another by mistake.'],
  ['Can I change an invoice after I issue it?', 'No. An issued invoice and the activity log cannot be edited or deleted. Mistakes are fixed with credit and debit notes, which keeps your record clean for your CA.'],
  ['Do you need my GST portal password?', 'Never. We do not ask for it.'],
  ['Can I use Kora if I am not registered for GST?', 'Yes. When you set up your business you can choose that you are not registered for GST.'],
  ['Is everything switched on yet?', 'Kora is in early access. Some connections, such as WhatsApp delivery and live e-invoice registration, are being switched on with our partners.'],
];

const DO_MORE: [string, string, string][] = [
  ['send', 'Send and schedule invoices', 'Share an invoice on WhatsApp, SMS or email the moment it is issued, and let reminders follow up on the schedule you set.'],
  ['pay', 'Collect payments', 'Every invoice carries a UPI QR and a pay link for the amount still due. Part payments are handled, and payments match themselves.'],
  ['repeat', 'Manage recurring invoices', 'Billing the same customer every month or week? Set the schedule once and Kora creates each invoice for you.'],
];

const LOOKS: [string, string][] = [
  ['classic', 'Classic'],
  ['modern', 'Modern'],
  ['minimal', 'Minimal'],
  ['compact', 'Compact'],
];

function Paper({ v }: { v: string }) {
  return (
    <div className={`paper ${v}`} aria-hidden="true">
      <div className="p-head"><span className="p-logo" /><span className="p-title">INVOICE</span></div>
      <div className="p-meta"><i /><i /><i /></div>
      <div className="p-table">
        <div className="p-row h"><i /><i /><i /></div>
        {Array.from({ length: v === 'compact' ? 6 : 3 }).map((_, n) => <div className="p-row" key={n}><i /><i /><i /></div>)}
      </div>
      <div className="p-total"><i /><b /></div>
    </div>
  );
}

function Mock({ k }: { k: string }) {
  if (k === 'send') return (
    <div className="mk">
      <div className="mk-bar"><span>Send invoice</span><span aria-hidden="true">&times;</span></div>
      <div className="mk-tabs"><span className="on">WhatsApp</span><span>SMS</span><span>Email</span></div>
      <div className="mk-sheet"><i /><i /><i className="short" /></div>
    </div>
  );
  if (k === 'pay') return (
    <div className="mk">
      <div className="mk-pay"><span className="mk-ic" /><div><b>INV-0042</b><small>Balance due</small></div><strong>Rs 19,470.00</strong></div>
      <div className="mk-upi"><span className="l-qr" /><div><b>Pay by UPI</b><small>The amount is filled in for you.</small></div></div>
    </div>
  );
  return (
    <div className="mk">
      <div className="mk-rec"><b>Monthly retainer</b><span className="chip paid">Active</span></div>
      <dl className="mk-dl"><div><dt>Repeats</dt><dd>Every month</dd></div><div><dt>Next invoice</dt><dd>1st of the month</dd></div><div><dt>Payment terms</dt><dd>Due in 7 days</dd></div></dl>
    </div>
  );
}

export default function Landing() {
  return (
    <LandingMotion>
      <a className="k-skip" href="#main-content">Skip to content</a>
      <div className="k-topbar"><a href="/" aria-label="Kora home">kora<span>Business, beautifully simple.</span></a><a href="/login">Sign in <span aria-hidden="true">↗</span></a></div>
      <header className="l-header">
        <div className="l-wrap l-bar">
          <a className="l-brand" href="/" aria-label="Kora Invoice home"><span className="k-product-icon"><Icon name="invoice" size={34} /></span><span><small>Kora</small>Invoice</span></a>
          <nav aria-label="Primary">
            <a href="#features">Features</a>
            <a href="#looks">Templates</a>
            <a href="#who">For your business</a>
            <a href="#trust">Resources</a>
            <a className="btn" href="/login?signup=1">Get started <Icon name="arrow" size={15} /></a>
          </nav>
          <details className="k-mobile-menu"><summary aria-label="Navigation menu"><Icon name="menu" size={24} /></summary><nav aria-label="Mobile navigation"><a href="#features">Features</a><a href="#looks">Templates</a><a href="#who">For your business</a><a href="#trust">Resources</a><a href="/login">Sign in</a><a href="/login?signup=1">Get started →</a></nav></details>
        </div>
      </header>

      <main id="main-content">
        <div className="l-wrap">
          <section className="l-hero">
            <h1>GST invoicing software<br />for your business</h1>
            <p className="l-lead">Create professional invoices, track payments, and prepare your GST reports with Kora.</p>
            <div className="l-cta">
              <a className="btn" href="/login?signup=1">Get started with Kora <Icon name="arrow" size={18} /></a>
              <a className="k-demo-link" href="#product-preview"><span aria-hidden="true">▷</span> Explore how it works</a>
            </div>
            <p className="l-note">Built in India. Built for your business. <span>Now in early access.</span></p>
          </section>

          <section className="k-benefits" aria-label="Kora at a glance">
            {TILES.map(([c, ic, t, d]) => (
              <article key={t} className={`k-benefit ${c}`}><div className="k-benefit-top"><Icon name={ic} size={26} /></div><h3>{t}</h3><p>{d}</p></article>
            ))}
          </section>
          <InvoiceShowcase />
        </div>

        <section id="how" className="l-dark" aria-labelledby="h-h">
          <div className="l-wrap l-how">
            <div>
              <h2 id="h-h">From first login to <span className="hl">first payment</span></h2>
              <ul className="l-steps">
                {STEPS.map(([t, d]) => (
                  <li key={t}><div><h3>{t}</h3><p>{d}</p></div></li>
                ))}
              </ul>
            </div>
            <div className="l-dash" aria-hidden="true">
              <h3>This month <small>Sample figures</small></h3>
              <div className="row3">
                <div><span>Billed</span><b>Rs 4,82,100</b></div>
                <div className="good"><span>Paid</span><b>Rs 3,10,000</b></div>
                <div className="bad"><span>Overdue</span><b>Rs 72,400</b></div>
              </div>
              <div className="bars"><i style={{ height: '38%' }} /><i style={{ height: '58%' }} /><i style={{ height: '50%' }} /><i style={{ height: '76%' }} /><i style={{ height: '64%' }} /><i className="now" style={{ height: '92%' }} /></div>
            </div>
          </div>
        </section>

        <div className="l-wrap">
          <section id="features" className="l-section" aria-labelledby="f-h">
            <h2 id="f-h">Everything an invoice needs, <span className="hl">nothing it does not</span></h2>
            <p className="l-sub">Quotes, invoices, payments, reminders and returns data, in one place that stays correct.</p>
            <div className="l-features">
              {FEATURES.map(([ic, t, d]) => (
                <article key={t} className="l-feature"><div className="ico"><Icon name={ic} size={20} /></div><div><h3>{t}</h3><p>{d}</p></div></article>
              ))}
            </div>
          </section>

          <section id="more" className="l-section" aria-labelledby="m-h">
            <h2 id="m-h"><span className="hl">Do more</span> with Kora</h2>
            <div className="l-do">
              {DO_MORE.map(([k, t, d]) => (
                <article key={k} className="l-do-card"><div className="l-do-text"><h3>{t}</h3><p>{d}</p></div><div className="l-do-mock" aria-hidden="true"><Mock k={k} /></div></article>
              ))}
            </div>
          </section>

          <section id="who" className="l-section" aria-labelledby="w-h">
            <h2 id="w-h">One product, <span className="hl">whoever you bill</span></h2>
            <p className="l-sub">The same careful invoicing underneath, with the tools your kind of work needs on top.</p>
            <div className="l-grid">
              {SEGMENTS.map(([ic, t, d], i) => (
                <article key={t} className="l-card"><div className={`ico ${TINTS[i % 4]}`}><Icon name={ic} size={22} /></div><h3>{t}</h3><p>{d}</p></article>
              ))}
            </div>
          </section>

          <section id="looks" className="l-section" aria-labelledby="l-h">
            <h2 id="l-h">Invoices that look <span className="hl">like your brand</span></h2>
            <p className="l-sub">Pick a look, add your logo and colour, and every invoice and PDF follows it.</p>
            <TemplateCarousel>
              {LOOKS.map(([v, label]) => (
                <a key={v} className="tpl-card" href="/login?signup=1"><div className="tpl-thumb"><Paper v={v} /></div><div className="tpl-foot"><span>{label}</span><Icon name="arrow" size={18} /></div></a>
              ))}
            </TemplateCarousel>
          </section>

          <section className="l-section" aria-label="What Kora guarantees">
            <div className="l-proof">
              <div className="l-proof-l">
                <h2>Built so the books add up</h2>
                <p>Consistent invoice records and accurate totals for you and your CA.</p>
              </div>
              <div className="l-proof-r" role="list">
                {FACTS.map(([t, d]) => (
                  <div key={t} role="listitem"><b>{t}</b><span>{d}</span></div>
                ))}
              </div>
            </div>
          </section>

          <section id="trust" className="l-section" aria-labelledby="t-h">
            <h2 id="t-h">Built to be run <span className="hl">with your CA</span></h2>
            <p className="l-sub">Straight answers about what Kora does and does not do.</p>
            <div className="l-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}><summary>{q}</summary><p>{a}</p></details>
              ))}
            </div>
          </section>
        </div>

        <section className="l-dark l-close" aria-labelledby="c-h">
          <div className="l-wrap">
            <h2 id="c-h">Simpler invoicing.<br />From here on.</h2>
            <p>Create your first invoice with Kora.</p>
            <a className="btn" href="/login?signup=1">Get started with Kora <Icon name="arrow" size={18} /></a>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap">
          <div>
            <a className="l-brand" href="/" aria-label="Kora home"><span className="brand-mark" aria-hidden="true">k</span>kora</a>
            <p>GST invoicing and collections for Indian businesses.</p>
          </div>
          <nav aria-label="Product">
            <h3>Product</h3>
            <a href="#features">Features</a>
            <a href="#who">Who it is for</a>
            <a href="#how">How it works</a>
          </nav>
          <nav aria-label="Legal">
            <h3>Trust</h3>
            <a href="#trust">Questions</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
          </nav>
          <div className="l-legal">Kora prepares your documents. You and your CA stay responsible for every invoice and filing.</div>
        </div>
      </footer>
    </LandingMotion>
  );
}
