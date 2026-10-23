import type { Metadata } from 'next';
import KoraLogo from '../../../components/KoraLogo';

export const metadata: Metadata = { title: 'Thank you', robots: { index: false } };

/** Where the payment page sends the customer afterwards. The invoice is marked paid when the gateway confirms, which takes a moment. */
export default function Thanks() {
  return (
    <main className="auth">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <div className="auth-brand"><a href="/" aria-label="Kora home"><KoraLogo /></a></div>
        <h1>Thank you</h1>
        <p className="lead">Your payment was received. The invoice shows as paid as soon as the payment is confirmed, usually within a minute. You can close this page.</p>
      </div>
    </main>
  );
}
