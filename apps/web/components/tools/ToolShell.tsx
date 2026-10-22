import type { ReactNode } from 'react';
import Icon from '../Icon';
import { SiteFooter, SiteHeader } from '../SiteChrome';
import { TOOLS, toolIcon, type Tool } from '../../lib/tools';

type IconName = React.ComponentProps<typeof Icon>['name'];

/** Page frame for the free tools: the shared header and footer around full-width bands. */
export function ToolsShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing kora-home">
      <SiteHeader />
      <main id="main-content" className="tools-main">{children}</main>
      <SiteFooter tools={false} />
    </div>
  );
}

/** Pale gradient hero: breadcrumb, badge, title, a coloured second line, two buttons and three facts. */
export function ToolHero({ crumbs, badge, title, highlight, lead, primary, secondary, stats }: {
  crumbs: [string, string][]; badge: string; title: string; highlight?: string; lead: string;
  primary?: [string, string]; secondary?: [string, string]; stats?: [string, string][];
}) {
  return (
    <section className="vt-hero no-print">
      <div className="vt-wrap">
        <nav className="vt-crumbs" aria-label="Breadcrumb">
          {crumbs.map(([t, h], i) => <span key={t}>{i > 0 && <span aria-hidden="true"> / </span>}{h ? <a href={h}>{t}</a> : t}</span>)}
        </nav>
        <p className="vt-badge"><Icon name="check" size={16} />{badge}</p>
        <h1>{title}{highlight && <span className="vt-hl">{highlight}</span>}</h1>
        <p className="vt-lead">{lead}</p>
        {(primary || secondary) && (
          <div className="vt-cta">
            {primary && <a className="btn" href={primary[1]}>{primary[0]}</a>}
            {secondary && <a className="btn secondary" href={secondary[1]}>{secondary[0]}</a>}
          </div>
        )}
        {stats && <dl className="vt-stats">{stats.map(([v, l]) => <div key={l}><dt>{v}</dt><dd>{l}</dd></div>)}</dl>}
      </div>
    </section>
  );
}

/** A band with a centred heading. The last words of the heading can be coloured. */
export function Band({ id, title, accent, sub, tone, children }: { id?: string; title: string; accent?: string; sub?: string; tone?: 'alt'; children: ReactNode }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section id={id} className={`vt-sec no-print${tone ? ` ${tone}` : ''}`} aria-labelledby={hid}>
      <div className="vt-wrap">
        <h2 id={hid}>{title}{accent && <> <span className="vt-hlw">{accent}</span></>}</h2>
        {sub && <p className="vt-sub">{sub}</p>}
        {children}
      </div>
    </section>
  );
}

export function Steps({ steps }: { steps: [string, string][] }) {
  return (
    <ol className="vt-steps">
      {steps.map(([t, d], i) => <li key={t}><span className="vt-num" aria-hidden="true">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}
    </ol>
  );
}

const TINTS = ['pink', 'mint', 'sky', 'sun'];
export function Cards({ items }: { items: [string, string, IconName?][] }) {
  return (
    <div className="vt-cards">
      {items.map(([t, d, ic], i) => (
        <article key={t} className="vt-card">
          {ic && <span className={`vt-ico ${TINTS[i % 4]}`}><Icon name={ic} size={22} /></span>}
          <h3>{t}</h3><p>{d}</p>
        </article>
      ))}
    </div>
  );
}

export function Faq({ items }: { items: [string, string][] }) {
  return (
    <div className="vt-faq">
      {items.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
    </div>
  );
}

export { toolIcon };

/** Links to the other tools, like the "Special purpose tools" strip on the reference. */
export function MoreTools({ current }: { current?: string }) {
  const list: Tool[] = TOOLS.filter((t) => t.slug !== current);
  return (
    <div className="vt-more">
      {list.map((t) => <a key={t.slug} href={`/tools/${t.slug}`}><span className="vt-ico sky"><Icon name={toolIcon(t.slug)} size={20} /></span><span>{t.title}</span><Icon name="arrow" size={16} /></a>)}
    </div>
  );
}

const CAPS: [string, IconName][] = [
  ['GST invoices numbered in order', 'invoice'], ['Send on WhatsApp, SMS and email', 'chat'], ['UPI QR and pay links', 'qr'],
  ['Payment reminders that go out by themselves', 'rupee'], ['Reports and GSTR-1 data for your CA', 'chart'], ['Works on your phone, even offline', 'phone'],
];

/** A dark band that points from a free tool to the product. */
export function Cross({ title, text }: { title: string; text: string }) {
  return (
    <section className="vt-cross no-print" aria-labelledby="cross-h">
      <div className="vt-wrap">
        <h2 id="cross-h">{title}</h2>
        <p>{text}</p>
        <ul>{CAPS.map(([t, ic]) => <li key={t}><Icon name={ic} size={18} />{t}</li>)}</ul>
        <a className="btn" href="/login?signup=1">Try Kora free <Icon name="arrow" size={15} /></a>
      </div>
    </section>
  );
}
