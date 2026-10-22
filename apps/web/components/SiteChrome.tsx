import KoraLogo from './KoraLogo';
import Icon from './Icon';
import SiteThemeToggle from './SiteThemeToggle';
import { TOOLS, toolIcon } from '../lib/tools';
import '../app/site-tools.css';

/** The top bar and footer shared by the landing page, pricing, help and the legal pages. */
export function SiteHeader() {
  const links: [string, string][] = [['/#features', 'Features'], ['/#looks', 'Templates'], ['/#who', 'For your business'], ['/pricing', 'Pricing'], ['/download', 'Download']];
  const help: [string, string] = ['/help', 'Help'];
  return (
    <>
      <a className="k-skip" href="#main-content">Skip to content</a>
      <div className="k-topbar"><a href="/" aria-label="Kora home">kora<span>Business, beautifully simple.</span></a><div className="site-header-actions"><SiteThemeToggle /><a href="/login">Sign in <span aria-hidden="true">↗</span></a></div></div>
      <header className="l-header">
        <div className="l-wrap l-bar">
          <a className="l-brand" href="/" aria-label="Kora Invoice home"><KoraLogo /></a>
          <nav aria-label="Primary">
            {links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
            <div className="k-menu">
              <a href="/tools" aria-haspopup="true">Tools <Icon name="arrow" size={13} /></a>
              <div className="k-menu-pop" role="group" aria-label="Free tools">
                {TOOLS.map((t) => <a key={t.slug} href={`/tools/${t.slug}`}><span className="k-menu-ico"><Icon name={toolIcon(t.slug)} size={16} /></span>{t.title}</a>)}
                <a className="k-menu-all" href="/tools">See all free tools <Icon name="arrow" size={13} /></a>
              </div>
            </div>
            <a href={help[0]}>{help[1]}</a>
            <a className="btn" href="/login?signup=1">Get started <Icon name="arrow" size={15} /></a>
          </nav>
          <details className="k-mobile-menu"><summary aria-label="Navigation menu"><Icon name="menu" size={24} /></summary>
            <nav aria-label="Mobile navigation">
              {links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
              <a href="/tools">Free tools</a>
              <a href={help[0]}>{help[1]}</a>
              <a href="/login">Sign in</a><a href="/login?signup=1">Get started →</a>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}

/** Wrapper for every public page except the landing page itself. */
export function MarketingPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="landing kora-home">
      <SiteHeader />
      <main id="main-content" className={`l-wrap site-main${wide ? ' wide' : ''}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}

/** The free tools as a strip of cards, just above the footer. */
export function ToolsStrip() {
  return (
    <section className="k-toolstrip" aria-labelledby="k-toolstrip-h">
      <div className="l-wrap">
        <h2 id="k-toolstrip-h">Free tools for your <span>business</span></h2>
        <p>No signup. Everything runs in your browser.</p>
        <div className="k-toolstrip-grid">
          {TOOLS.map((t) => <a key={t.slug} href={`/tools/${t.slug}`}><span className="k-menu-ico"><Icon name={toolIcon(t.slug)} size={20} /></span><span>{t.title}</span></a>)}
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ tools = true }: { tools?: boolean }) {
  return (
    <>
    {tools && <ToolsStrip />}
    <footer className="l-footer">
      <div className="l-wrap">
        <div>
          <a className="l-brand" href="/" aria-label="Kora home"><KoraLogo /></a>
          <p>GST invoicing and collections for Indian businesses.</p>
        </div>
        <nav aria-label="Product">
          <h3>Product</h3>
          <a href="/#features">Features</a>
          <a href="/#who">Who it is for</a>
          <a href="/#how">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="/download">Download the app</a>
          <a href="/tools">Free tools</a>
        </nav>
        <nav aria-label="Help">
          <h3>Help</h3>
          <a href="/help">Help centre</a>
          <a href="/import-guide">Move from other software</a>
          <a href="/#security">Security</a>
          <a href="/#trust">Questions</a>
        </nav>
        <nav aria-label="Legal">
          <h3>Legal</h3>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/refunds">Refunds</a>
        </nav>
        <div className="l-legal">Kora prepares your documents. You and your CA stay responsible for every invoice and filing.</div>
      </div>
    </footer>
    </>
  );
}
