'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/client';
import { IMPORT_SOURCES } from '../../../lib/importGuide';
import ListImport from '../../../components/ListImport';
import InvoiceImport from '../../../components/InvoiceImport';

/** A guided way in from other software. It uses the same importers as the Data page. */
export default function ImportGuide() {
  const [role, setRole] = useState('');
  const [src, setSrc] = useState(IMPORT_SOURCES[0]!.id);
  useEffect(() => { api('/api/business').then((b) => setRole(b.role)).catch(() => {}); }, []);
  const s = IMPORT_SOURCES.find((x) => x.id === src)!;
  const canImport = role === 'owner' || role === 'staff';

  return (
    <>
      <h1>Move to Kora</h1>
      <p className="muted">Bring your customers, items and old invoices across in three steps. Nothing is changed until you confirm.</p>

      <section className="panel" aria-labelledby="s1">
        <h2 id="s1">1. Where are you coming from?</h2>
        <div role="radiogroup" aria-label="Your old software" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {IMPORT_SOURCES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={src === x.id} className={src === x.id ? '' : 'secondary'} style={{ marginTop: 0 }} onClick={() => setSrc(x.id)}>{x.name}</button>
          ))}
        </div>
        <h3 style={{ marginTop: 18 }}>2. Export from {s.name}</h3>
        <p className="muted">File: {s.file}. {s.fileNote}</p>
        <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
        <p><b>What comes across:</b> {s.brings.join('; ')}.</p>
        <p className="muted"><b>What does not:</b> {s.notBrought.join('; ')}.</p>
      </section>

      <section className="panel" aria-labelledby="s3">
        <h2 id="s3">3. Upload your customers and items</h2>
        {!canImport ? <p className="muted">Importing is for the owner and staff.</p> : <ListImport />}
      </section>

      {canImport && (
        <section aria-label="Old invoices">
          <p className="muted">Have old invoices in a spreadsheet? They come in as drafts, so you can look at each one before it gets a Kora number.</p>
          <InvoiceImport />
        </section>
      )}
      <p className="muted">Stuck? <a href="/help/import-from-other-software">Read the import guide</a> or see all <a href="/help">help guides</a>.</p>
    </>
  );
}
