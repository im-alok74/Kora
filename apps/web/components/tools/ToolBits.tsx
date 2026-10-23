'use client';
import { useId, useRef, useState, type ReactNode } from 'react';

/**
 * A file chooser that also takes dropped files. The real file input stays on the page (keyboard and screen reader users get it as is);
 * the drop area only adds the drag and drop. Files that do not match `accept` are handed on anyway, so the tool can name each one in its message.
 */
export function FileDrop({ label, hint, accept, multiple, onFiles, id }: { label: string; hint: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void; id?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`tl-drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : f.slice(0, 1)); }}
    >
      <label htmlFor={inputId}>{label}</label>
      <input ref={ref} id={inputId} type="file" accept={accept} multiple={multiple} onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFiles(f); e.target.value = ''; }} />
      <p className="muted">{hint}</p>
    </div>
  );
}

/** Where a tool says what it is doing, or what went wrong. Screen readers hear changes. */
export function Status({ busy, error, note }: { busy?: string; error?: string; note?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="tl-status">
      {busy ? <p className="tl-busy"><span className="tl-spin" aria-hidden="true" />{busy}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!busy && !error && note ? <p className="muted">{note}</p> : null}
    </div>
  );
}

/** The line every file tool shows under its result. */
export const PRIVATE_NOTE = 'Your files stay on this device. They are opened and saved inside your browser and are never uploaded.';

/** A small "Copy" button that says it copied. */
export function CopyButton({ text, label = 'Copy', what }: { text: string; label?: string; what?: string }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <button type="button" className="secondary tl-copy" aria-label={what ? `${label} ${what}` : label} onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked: the text is on screen to select */ }
      }}>{done ? 'Copied' : label}</button>
      <span className="sr-only" role="status">{done ? 'Copied to the clipboard' : ''}</span>
    </>
  );
}
