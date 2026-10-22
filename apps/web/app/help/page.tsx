import type { Metadata } from 'next';
import { MarketingPage } from '../../components/SiteChrome';
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp } from '../../lib/help';
import '../landing.css';
import '../landing-dark.css';
import '../site.css';

export const metadata: Metadata = {
  title: 'Help centre',
  description: 'Short how-to guides for Kora: your first invoice, GST basics, e-invoicing, reminders, importing your data and managing your team.',
  alternates: { canonical: '/help' },
};

// Search works with a plain form and no script: /help?q=reminders
export default async function Help({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 80);
  const results = q ? searchHelp(q) : null;
  return (
    <MarketingPage>
      <h1>Help centre</h1>
      <p className="lead">Short answers in plain words. Search, or pick a topic.</p>
      <form className="help-search" role="search" action="/help" method="get">
        <label htmlFor="hq" className="sr-only">Search help</label>
        <input id="hq" name="q" type="search" defaultValue={q} placeholder="Try: reminders, GSTIN, import" autoComplete="off" />
        <button type="submit">Search</button>
      </form>

      {results ? (
        <section aria-live="polite">
          <h2>{results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'} for "${q}"` : `Nothing found for "${q}"`}</h2>
          {results.length === 0 && <p>Try a shorter word, or <a href="/help">see every guide</a>. Still stuck? Write to us from inside the app.</p>}
          <div className="help-cats">
            {results.map((a) => <a key={a.slug} className="help-card" href={`/help/${a.slug}`}><b>{a.title}</b><span>{a.summary}</span></a>)}
          </div>
        </section>
      ) : (
        HELP_CATEGORIES.map((c) => (
          <section key={c} aria-labelledby={`c-${c}`}>
            <h2 id={`c-${c}`}>{c}</h2>
            <div className="help-cats">
              {HELP_ARTICLES.filter((a) => a.category === c).map((a) => <a key={a.slug} className="help-card" href={`/help/${a.slug}`}><b>{a.title}</b><span>{a.summary}</span></a>)}
            </div>
          </section>
        ))
      )}
      <p className="muted" style={{ marginTop: 40 }}>Moving from other software? See the <a href="/import-guide">import guide</a>.</p>
    </MarketingPage>
  );
}
