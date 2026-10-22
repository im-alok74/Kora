import type { Metadata } from 'next';
import { MarketingPage } from '../components/SiteChrome';
import './landing.css';
import './landing-dark.css';
import './site.css';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

/** The 404 for the whole site. It says what happened and where to go next. */
export default function NotFound() {
  return (
    <MarketingPage>
      <h1>We could not find that page</h1>
      <p className="lead">The link may be old, or the address may have a typing mistake.</p>
      <ul>
        <li><a href="/">Go to the home page</a></li>
        <li><a href="/app">Open your Kora account</a> (if you are signed in)</li>
        <li><a href="/help">Search the help centre</a></li>
        <li><a href="/pricing">See the plans</a></li>
      </ul>
      <p className="muted">If someone sent you a link to an invoice or a payment page and it shows this message, ask them to send it again. Links can be replaced or switched off by the business that sent them.</p>
    </MarketingPage>
  );
}
