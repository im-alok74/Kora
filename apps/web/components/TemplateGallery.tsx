'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';

type Look = { key: string; label: string; about: string; html: string };

/** Samples of each look, drawn with the business's own colour, font and details. Click one to choose it. */
export default function TemplateGallery({ template, current, disabled, onPick }: { template: object; current: string; disabled: boolean; onPick: (key: string) => void }) {
  const [looks, setLooks] = useState<Look[] | null>(null);
  const [err, setErr] = useState('');
  const sig = JSON.stringify({ ...template, layout: 'classic' });          // the look itself does not change what the samples show
  useEffect(() => {
    const h = setTimeout(() => { api('/api/template/gallery', { body: JSON.parse(sig) }).then((r) => { setLooks(r.layouts); setErr(''); }).catch((e) => setErr(e.message)); }, 400);
    return () => clearTimeout(h);
  }, [sig]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!looks) return <p className="muted" role="status">Loading the looks</p>;
  return (
    <div className="gallery" role="group" aria-label="Choose a look">
      {looks.map((l) => (
        <button key={l.key} type="button" className={`look${current === l.key ? ' on' : ''}`} aria-pressed={current === l.key} disabled={disabled} onClick={() => onPick(l.key)}>
          <span className="thumb" aria-hidden="true"><iframe title={`${l.label} sample`} sandbox="" srcDoc={l.html} tabIndex={-1} /></span>
          <b>{l.label}</b><span className="muted">{l.about}</span>
        </button>))}
    </div>
  );
}
