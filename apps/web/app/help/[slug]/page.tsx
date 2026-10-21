import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketingPage } from '../../../components/SiteChrome';
import { HELP_ARTICLES, bySlug } from '../../../lib/help';
import '../../landing.css';
import '../../site.css';

export const dynamicParams = false;
export const generateStaticParams = () => HELP_ARTICLES.map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = bySlug((await params).slug);
  return a ? { title: a.title, description: a.summary, alternates: { canonical: `/help/${a.slug}` } } : {};
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const a = bySlug((await params).slug);
  if (!a) notFound();
  const related = a.related.map(bySlug).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <MarketingPage>
      <p className="crumbs"><a href="/help">Help centre</a> / {a.category}</p>
      <article className="article">
        <h1>{a.title}</h1>
        <p className="lead">{a.summary}</p>
        {a.body.map((p) => <p key={p}>{p}</p>)}
        {a.steps && (<><h2>Steps</h2><ol>{a.steps.map((s) => <li key={s}>{s}</li>)}</ol></>)}
      </article>
      {related.length > 0 && (
        <nav className="related" aria-label="Related guides">
          <h2>Related guides</h2>
          <ul>{related.map((r) => <li key={r.slug}><a href={`/help/${r.slug}`}>{r.title}</a></li>)}</ul>
        </nav>
      )}
    </MarketingPage>
  );
}
