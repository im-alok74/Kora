import type { Metadata } from 'next';
import { MarketingPage } from '../../components/SiteChrome';
import { IMPORT_SOURCES } from '../../lib/importGuide';
import '../landing.css';
import '../site.css';

export const metadata: Metadata = {
  title: 'Move to Kora from other software',
  description: 'How to bring your customers, items and invoices into Kora from Zoho, Vyapar, Tally or any spreadsheet.',
  alternates: { canonical: '/import-guide' },
};

export default function ImportGuide() {
  return (
    <MarketingPage wide>
      <h1>Move to Kora from other software</h1>
      <p className="lead">Bring your customers and items across in a few minutes. Old invoices come in as drafts, so you check each one before it gets a Kora number.</p>
      <div className="import-grid">
        {IMPORT_SOURCES.map((s) => (
          <section key={s.id} className="import-card" aria-labelledby={`g-${s.id}`}>
            <h2 id={`g-${s.id}`}>{s.name}</h2>
            <p className="muted">File: {s.file}. {s.fileNote}</p>
            <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
            <p><b>What comes across:</b> {s.brings.join('; ')}.</p>
            <p><b>What does not:</b> {s.notBrought.join('; ')}.</p>
          </section>
        ))}
      </div>
      <p style={{ marginTop: 32 }}><a className="btn" href="/login?signup=1">Create your account</a> <span className="muted">Already have one? Open <a href="/app/import">Import in the app</a>.</span></p>
      <p className="muted">Menus in other products change from version to version, so look for words like Export or Reports. If a file will not import, the preview tells you why, row by row.</p>
    </MarketingPage>
  );
}
