'use client';
import { useEffect } from 'react';

/** A screen inside the app broke. The side menu stays, and there is a clear next step. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="panel empty" role="alert" data-testid="app-error">
      <h1 style={{ fontSize: 24 }}>This screen could not load</h1>
      <p>It is a problem on our side. Anything you had already saved is safe.</p>
      <p><button type="button" onClick={() => reset()}>Try again</button> <a className="btn secondary" href="/app">Go to the dashboard</a></p>
      <p className="muted">If it keeps happening, <a href="/help">open the help centre</a>.{error.digest ? ` Mention this code if you write to us: ${error.digest}.` : ''}</p>
    </div>
  );
}
