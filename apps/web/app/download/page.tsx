import type { Metadata } from 'next';
import { MarketingPage } from '../../components/SiteChrome';
import InstallApp from '../../components/InstallApp';
import { getDownloads, type DownloadFile, type Platform } from '../../lib/downloads';
import '../landing.css';
import '../landing-dark.css';
import '../site.css';

export const metadata: Metadata = {
  title: 'Download Kora',
  description: 'Install Kora as an app on Windows, Mac, Android, iPhone and iPad. Same account, same invoices, on every device.',
  alternates: { canonical: '/download' },
};

const CARDS: { os: Platform | 'ios'; name: string; line: string; how: string[] }[] = [
  { os: 'windows', name: 'Windows', line: 'For Windows 10 and 11, 64-bit.', how: ['Download the file and open it.', 'If Windows shows "Windows protected your PC", choose More info, then Run anyway. The app is new and not yet signed.', 'Kora opens in its own window and adds a shortcut to your desktop.'] },
  { os: 'mac', name: 'Mac', line: 'For macOS 11 or newer, Apple chip or Intel.', how: ['Download the file and open it.', 'Drag Kora into the Applications folder.', 'The first time, right-click Kora and choose Open, because the app is not yet notarised by Apple.'] },
  { os: 'android', name: 'Android', line: 'For Android 8 or newer.', how: ['Download the file on your phone.', 'Open it and allow installs from this source if your phone asks.', 'Or skip the file: open Kora in Chrome and choose Install app from the menu.'] },
  { os: 'ios', name: 'iPhone and iPad', line: 'Installs from Safari, no store needed.', how: ['Open this site in Safari.', 'Tap the Share button.', 'Tap Add to Home Screen.'] },
];

function Action({ file, os }: { file?: DownloadFile; os: string }) {
  if (os === 'ios') return <p className="muted dl-note">Use the steps below.</p>;
  if (!file) return <span className="dl-soon" role="note">Installer not published yet. <a href="#dl-quick">Use browser installation</a>.</span>;
  return <a className="btn" href={file.url} download>Download <span aria-hidden="true">·</span> {file.sizeMb} MB<span className="sr-only"> {file.name}</span></a>;
}

export default async function DownloadPage() {
  const d = await getDownloads();
  return (
    <MarketingPage wide>
      <h1>Kora on every device</h1>
      <p className="lead">Use Kora as an app on your laptop, your phone and your tablet. It is the same account and the same invoices everywhere, so you can start on one device and finish on another.</p>

      <section className="dl-install" aria-labelledby="dl-quick">
        <h2 id="dl-quick">The quickest way: install from your browser</h2>
        <p>No separate installer needed. Your browser puts Kora on your desktop or home screen, and it opens in its own window.</p>
        <InstallApp />
        <p className="dl-browser-link">Prefer to get started straight away? <a href="/app">Open Kora in your browser →</a></p>
      </section>

      <h2>Or download the app{d.version ? <small className="muted"> version {d.version}</small> : null}</h2>
      <div className="dl-grid">
        {CARDS.map((c) => (
          <section key={c.os} className="dl-card" data-os={c.os} aria-labelledby={`dl-${c.os}`}>
            <h3 id={`dl-${c.os}`}>{c.name}</h3>
            <p className="muted">{c.line}</p>
            <Action file={c.os === 'ios' ? undefined : d.files[c.os]} os={c.os} />
            {(c.os === 'ios' || d.files[c.os]) && <ol>{c.how.map((h) => <li key={h}>{h}</li>)}</ol>}
          </section>
        ))}
      </div>

      <h2>Good to know</h2>
      <h3>Is the app a different product?</h3>
      <p>No. The app opens the same Kora you use in a browser, signed in the same way. Updates reach you without a new download.</p>
      <h3>Why does my computer warn me?</h3>
      <p>Kora is in early access and the downloads are not signed with a paid developer certificate yet, so Windows and macOS ask you to confirm. Installing from your browser avoids the warning.</p>
      <h3>Do I need to be online?</h3>
      <p>Sign in and open the invoicing screens while connected first. You can then save invoice drafts on that device without a connection. Drafts sync when you return online; issuing invoices and recording payments need a connection.</p>
    </MarketingPage>
  );
}
