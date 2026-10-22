'use client';
import { useEffect } from 'react';

/** Shown when a page breaks. It says what to do next instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px' }}>
      <h1>Something went wrong on our side</h1>
      <p>Nothing you entered has been lost if it was already saved. Try again in a moment.</p>
      <p><button type="button" onClick={() => reset()}>Try again</button></p>
      <p className="muted">Still stuck? <a href="/help">Open the help centre</a> or <a href="/">go to the home page</a>.{error.digest ? ` Mention this code if you write to us: ${error.digest}.` : ''}</p>
    </main>
  );
}
