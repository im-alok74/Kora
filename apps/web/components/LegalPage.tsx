import { MarketingPage } from './SiteChrome';
import '../app/landing.css';
import '../app/landing-dark.css';
import '../app/site.css';

/** A legal page. Every one carries a plain notice that it is a draft awaiting a lawyer. */
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <MarketingPage>
      <h1>{title}</h1>
      <p className="muted">Last updated {updated}</p>
      <div className="draft-banner" role="note"><b>Draft awaiting a lawyer.</b> This page is written in plain words to describe how Kora works today. It has not yet been reviewed by a lawyer and is not final legal text. Do not rely on it as legal advice.</div>
      {children}
    </MarketingPage>
  );
}
