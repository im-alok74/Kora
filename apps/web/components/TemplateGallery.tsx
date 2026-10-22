'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import Icon from './Icon';

type Look = { key: string; label: string; about: string; html: string };

/** Samples of each look, drawn with the business's own colour, font and details. Click one to choose it. */
export default function TemplateGallery({ template, current, disabled, onPick }: { template: object; current: string; disabled: boolean; onPick: (key: string) => void }) {
  const [looks, setLooks] = useState<Look[] | null>(null);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<Look | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  const sig = JSON.stringify({ ...template, layout: 'classic' });          // the look itself does not change what the samples show
  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(() => { api('/api/template/gallery', { body: JSON.parse(sig) }).then((r) => { if (!cancelled) { setLooks(r.layouts); setErr(''); } }).catch((e) => { if (!cancelled) setErr(e.message); }); }, 400);
    return () => { cancelled = true; clearTimeout(h); };
  }, [sig]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!looks) return <p className="muted" role="status">Loading the looks</p>;
  return (
    <><div className="gallery" role="group" aria-label="Choose an invoice template">
      {looks.map((l) => (
        <article className="template-option" key={l.key}>
        <button key={l.key} type="button" className={`look${current === l.key ? ' on' : ''}`} aria-pressed={current === l.key} disabled={disabled} onClick={() => onPick(l.key)}>
          <span className="thumb" aria-hidden="true"><iframe title={`${l.label} sample`} sandbox="" srcDoc={l.html} tabIndex={-1} /></span>
          <span className="template-name"><b>{l.label}</b>{current === l.key && <span className="template-selected"><Icon name="check" size={14} />Selected</span>}</span><span className="muted">{l.about}</span>
        </button>
        <button type="button" className="template-preview-link" onClick={() => setPreview(l)}>Preview template <Icon name="arrow" size={15} /></button>
        </article>))}
    </div>
    <dialog className="template-dialog" ref={dialog} onClose={() => setPreview(null)} aria-labelledby="template-preview-title">
      <div className="template-dialog-head"><h2 id="template-preview-title">{preview?.label} invoice template</h2><button type="button" className="iconbtn" aria-label="Close template preview" onClick={() => dialog.current?.close()} autoFocus><Icon name="close" size={20} /></button></div>
      {preview && <iframe title={`${preview.label} full invoice preview`} sandbox="" srcDoc={preview.html} />}
      <div className="template-dialog-foot"><p className="muted">Preview with your business details and current appearance settings.</p><button type="button" disabled={disabled} onClick={() => { if (preview) onPick(preview.key); dialog.current?.close(); }}>Use this template</button></div>
    </dialog></>
  );
}
