import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DocGenerator, { type DocKind } from '../../../components/tools/DocGenerator';
import GstCalculator from '../../../components/tools/GstCalculator';
import { BarcodeGenerator, QrGenerator, ScanTool } from '../../../components/tools/CodeTools';
import { EmiCalculator, InterestCalculator, ProfitMargin } from '../../../components/tools/CalcTools';
import LogoMaker from '../../../components/tools/LogoMaker';
import { ImageCompressor, ImageConverter } from '../../../components/tools/ImageTools';
import PdfToImage from '../../../components/tools/PdfToImage';
import { ImagesToPdf, MergeSplitPdf } from '../../../components/tools/PdfTools';
import { AmountInWords, GstinValidator, WordCounter } from '../../../components/tools/TextTools';
import { Band, Cards, Cross, Faq, MoreTools, Steps, ToolHero, ToolsShell } from '../../../components/tools/ToolShell';
import { TOOLS, toolBySlug } from '../../../lib/tools';
import { GST_SLABS, toolPageInfo } from '../../../lib/toolPages';
import { RELATED } from '../../../lib/toolPagesCalc';
import { SITE_URL } from '../../../lib/site';
import '../../landing.css';
import '../../landing-dark.css';
import '../../site.css';
import '../../tools.css';
import '../../tools-more.css';

export const dynamicParams = false;
export const generateStaticParams = () => TOOLS.map((t) => ({ slug: t.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = toolBySlug((await params).slug);
  if (!t) return {};
  const title = `Free ${t.title}, no signup`;
  return { title, description: t.summary, alternates: { canonical: `/tools/${t.slug}` }, openGraph: { type: 'website', title: `${title} | Kora`, description: t.summary, url: `/tools/${t.slug}` }, twitter: { card: 'summary_large_image', title: `${title} | Kora`, description: t.summary } };
}

const DOCS: Record<string, DocKind> = { 'invoice-generator': 'invoice', 'quotation-maker': 'quotation', 'proforma-invoice-generator': 'proforma', 'purchase-order-generator': 'purchase-order', 'receipt-maker': 'receipt' };

function Body({ slug }: { slug: string }) {
  if (DOCS[slug]) return <DocGenerator kind={DOCS[slug]!} />;
  switch (slug) {
    case 'gst-calculator': return <GstCalculator />;
    case 'qr-code-generator': return <QrGenerator />;
    case 'barcode-generator': return <BarcodeGenerator />;
    case 'qr-code-scanner': return <ScanTool mode="qr" />;
    case 'barcode-scanner': return <ScanTool mode="barcode" />;
    case 'logo-maker': return <LogoMaker />;
    case 'pdf-to-image': return <PdfToImage />;
    case 'image-converter': return <ImageConverter />;
    case 'image-compressor': return <ImageCompressor />;
    case 'images-to-pdf': return <ImagesToPdf />;
    case 'merge-split-pdf': return <MergeSplitPdf />;
    case 'gstin-validator': return <GstinValidator />;
    case 'amount-in-words': return <AmountInWords />;
    case 'word-counter': return <WordCounter />;
    case 'profit-margin-calculator': return <ProfitMargin />;
    case 'emi-calculator': return <EmiCalculator />;
    case 'interest-calculator': return <InterestCalculator />;
    default: return null;
  }
}

function GstFacts() {
  return (
    <>
      <Band id="slabs" title="GST tax slabs in" accent="India" sub="Most things you sell fall in one of four rates. Special rates apply to a few items, and the older 12% and 28% slabs apply to supplies made before 22 September 2025.">
        <div className="vt-slabs">
          {GST_SLABS.map(([rate, name, what, tint]) => <article key={rate} className={`vt-slab ${tint}`}><b>{rate}</b><h3>{name}</h3><p>{what}</p></article>)}
        </div>
      </Band>
      <Band id="types" title="CGST, SGST and" accent="IGST" tone="alt" sub="Which of these appears on your invoice depends on where the sale is made.">
        <Cards items={[
          ['CGST', 'Central GST. Charged with SGST when you sell inside one state, and it is half of the total rate. At 18%, CGST is 9%.', 'rupee'],
          ['SGST', 'State GST. The other half of the rate on a sale inside one state. At 18%, SGST is 9%.', 'home'],
          ['IGST', 'Integrated GST. Charged in full when you sell to another state. At 18%, IGST is 18%.', 'percent'],
        ]} />
      </Band>
      <Band id="formulas" title="How to calculate" accent="GST by hand">
        <div className="vt-formulas">
          <article className="vt-formula"><h3>Adding GST</h3><p>You have the price before tax.</p><code>GST = amount x rate / 100</code><code>Total = amount + GST</code><p className="vt-eg">Example at 18%: Rs 1,000 gives GST of Rs 180 and a total of Rs 1,180.</p></article>
          <article className="vt-formula"><h3>Removing GST</h3><p>You have the price with tax included.</p><code>Base = total x 100 / (100 + rate)</code><code>GST = total - base</code><p className="vt-eg">Example at 18%: Rs 1,180 gives a base of Rs 1,000 and GST of Rs 180.</p></article>
        </div>
      </Band>
    </>
  );
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const t = toolBySlug((await params).slug);
  if (!t) notFound();
  const info = toolPageInfo(t);
  const related = (RELATED[t.slug] ?? []).map(toolBySlug).filter((x): x is NonNullable<typeof x> => !!x);
  const url = `${SITE_URL}/tools/${t.slug}`;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: t.title, description: t.summary, url, applicationCategory: 'BusinessApplication', operatingSystem: 'Any (web browser)', inLanguage: 'en-IN', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' }, publisher: { '@type': 'Organization', name: 'Kora', url: SITE_URL } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: info.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Home', SITE_URL], ['Free tools', `${SITE_URL}/tools`], [t.title, url]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) },
  ];
  return (
    <ToolsShell>
      {ld.map((d, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }} />)}
      <ToolHero
        crumbs={[['Home', '/'], ['Free tools', '/tools'], [t.title, '']]}
        badge={info.badge} title={t.title} highlight={info.highlight} lead={info.lead}
        primary={[info.cta, '#tool']} secondary={['Try Kora free', '/login?signup=1']} stats={info.stats}
      />
      <section id="tool" className="vt-tool" aria-labelledby="tool-h">
        <div className="vt-wrap">
          <h2 id="tool-h" className="vt-tool-h no-print">{info.toolTitle} <span className="vt-hlw">{info.toolAccent}</span></h2>
          <Body slug={t.slug} />
        </div>
      </section>
      {info.about && (
        <Band id="about" tone="alt" title={info.about.title} accent={info.about.accent}>
          <div className="vt-text">{info.about.body.map((p) => <p key={p}>{p}</p>)}</div>
        </Band>
      )}
      {t.slug === 'gst-calculator' && <GstFacts />}
      <Band id="how" title={`How to use the ${t.title}`}>
        <Steps steps={info.steps} />
        {related.length > 0 && <p className="vt-related">Often used with: {related.map((r, i) => <span key={r.slug}>{i > 0 && ', '}<a href={`/tools/${r.slug}`}>{r.title}</a></span>)}.</p>}
      </Band>
      <Band id="why" title="Why use this" accent="tool" tone="alt"><Cards items={info.features} /></Band>
      <Cross title={info.crossTitle} text={info.crossText} />
      <Band id="faq" title="Frequently asked" accent="questions"><Faq items={info.faq} /></Band>
      <Band id="more" title="More free" accent="tools" tone="alt"><MoreTools current={t.slug} /></Band>
    </ToolsShell>
  );
}
