import KoraLogo from './KoraLogo';

/** Shared loading state: real work controls its lifetime, never a timer. */
export default function KoraLoader({ label = 'Loading your workspace', fullPage = false }: { label?: string; fullPage?: boolean }) {
  return <div className={`kora-loader${fullPage ? ' kora-loader-full' : ''}`} role="status" aria-live="polite">
    <div className="kora-loader-brand" aria-hidden="true">
      <KoraLogo />
    </div>
    <div className="kora-loader-track" aria-hidden="true"><span /></div>
    <span className="kora-loader-label">{label}</span>
  </div>;
}
