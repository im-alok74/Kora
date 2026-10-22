import KoraLogo from './KoraLogo';
import Icon from './Icon';
import SiteThemeToggle from './SiteThemeToggle';

/** The top bar and footer shared by the landing page, pricing, help and the legal pages. */
export function SiteHeader() {
  const links: [string, string][] = [['/#features', 'Features'], ['/#looks', 'Templates'], ['/#who', 'For your business'], ['/pricing', 'Pricing'], ['/help', 'Help']];
  return (
    <>
      <a className="k-skip" href="#main-content">Skip to content</a>
      <div className="k-topbar"><a href="/" aria-label="Kora home">kora<span>Business, beautifully simple.</span></a><div className="site-header-actions"><SiteThemeToggle /><a href="/login">Sign in <span aria-hidden="true">↗</span></a></div></div>
      <header className="l-header">
        <div className="l-wrap l-bar">
          <a className="l-brand" href="/" aria-label="Kora Invoice home"><KoraLogo /></a>
          <nav aria-label="Primary">
            {links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
            <a className="btn" href="/login?signup=1">Get started <Icon name="arrow" size={15} /></a>
          </nav>
          <details className="k-mobile-menu"><summary aria-label="Navigation menu"><Icon name="menu" size={24} /></summary>
            <nav aria-label="Mobile navigation">
              {links.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
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

export function SiteFooter() {
  return (
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
  );
}
