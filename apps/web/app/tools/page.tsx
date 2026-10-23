import type { Metadata } from 'next';
import Icon from '../../components/Icon';
import { Band, Cross, ToolHero, ToolsShell, toolIcon } from '../../components/tools/ToolShell';
import { TOOLS, TOOL_GROUPS } from '../../lib/tools';
import '../landing.css';
import '../landing-dark.css';
import '../site.css';
import '../tools.css';

export const metadata: Metadata = {
  title: 'Free business tools',
  description: 'Free tools for Indian businesses: GST calculator, invoice, quotation, proforma and purchase order makers, receipt maker, QR and barcode tools, and a logo maker.',
  alternates: { canonical: '/tools' },
  openGraph: { type: 'website', title: 'Free business tools | Kora', description: 'Free GST calculator, invoice, quotation, proforma, purchase order and receipt makers, QR and barcode tools and a logo maker.', url: '/tools' },
};

const TINTS = ['pink', 'mint', 'sky', 'sun'];

export default function Tools() {
  return (
    <ToolsShell>
      <ToolHero
        crumbs={[['Home', '/'], ['Free tools', '']]}
        badge="Free, no signup" title="Free business tools" highlight="Small tools that do one job well"
        lead="Make an invoice, work out GST, print a barcode or draw a logo. Each tool runs in your browser, there is nothing to sign up for, and what you type stays on your device."
        primary={['Browse the tools', '#all-tools']} secondary={['Try Kora free', '/login?signup=1']}
        stats={[[String(TOOLS.length), 'Free tools'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']]}
      />
      <div id="all-tools">
        {TOOL_GROUPS.map((g, gi) => (
          <Band key={g} id={`g-${gi}`} title={g} tone={gi % 2 ? 'alt' : undefined}>
            <div className="vt-toolgrid">
              {TOOLS.filter((t) => t.group === g).map((t, i) => (
                <a key={t.slug} className="vt-toolcard" href={`/tools/${t.slug}`}>
                  <span className={`vt-ico ${TINTS[i % 4]}`}><Icon name={toolIcon(t.slug)} size={22} /></span>
                  <b>{t.title}</b>
                  <span>{t.summary}</span>
                  <span className="vt-go" aria-hidden="true">Open the tool <Icon name="arrow" size={15} /></span>
                </a>
              ))}
            </div>
          </Band>
        ))}
      </div>
      <Cross title="Want invoices that look after themselves?" text="Kora numbers invoices in order, sends them on WhatsApp with a UPI QR and chases payments for you." />
    </ToolsShell>
  );
}
