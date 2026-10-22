/** A missing record or page inside the app: say so, and give the way back. */
export default function AppNotFound() {
  return (
    <div className="panel empty" data-testid="app-not-found">
      <h1 style={{ fontSize: 24 }}>That page or record is not here</h1>
      <p>It may have been removed, or it belongs to a different business. Check that the business shown at the top of the side menu is the one you meant.</p>
      <p><a className="btn" href="/app">Go to the dashboard</a> <a className="btn secondary" href="/app/invoices">Open documents</a></p>
      <p className="muted">Need a hand? <a href="/help">Open the help centre</a>.</p>
    </div>
  );
}
