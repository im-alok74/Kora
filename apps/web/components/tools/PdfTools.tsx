'use client';
import { useRef, useState } from 'react';
import { baseName, downloadBlob, LIMITS, loadPicture, makeZip, nextFrame, pictureProblem, readBytes, renderPicture } from '../../lib/browserFiles';
import { extractPages, imagesToPdf, mergePdfs, pageCountOf, parsePageGroups, parsePageList, PdfProblem, rotatePages, type PageImage, type PageSize } from '../../lib/pdfOps';
import { formatBytes } from '../../lib/sizeTarget';
import { FileDrop, PRIVATE_NOTE, Status } from './ToolBits';

const MAX_PICTURES = 50;
const bytesOf = (blobParts: Uint8Array) => new Blob([blobParts as BlobPart], { type: 'application/pdf' });

/** A reorderable list: the buttons work with a keyboard and a thumb, so no dragging is needed. */
function OrderList<T extends { id: string; name: string; size: number; extra?: string }>({ items, onChange, label }: { items: T[]; onChange: (n: T[]) => void; label: string }) {
  const move = (i: number, d: number) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };
  return (
    <ol className="tl-files" aria-label={label}>
      {items.map((f, i) => (
        <li key={f.id}>
          <span>{i + 1}. {f.name}</span>
          <small>{f.extra ? `${f.extra}, ` : ''}{formatBytes(f.size)}</small>
          <span className="tl-mv">
            <button type="button" className="secondary" disabled={i === 0} aria-label={`Move ${f.name} up`} onClick={() => move(i, -1)}>Up</button>
            <button type="button" className="secondary" disabled={i === items.length - 1} aria-label={`Move ${f.name} down`} onClick={() => move(i, 1)}>Down</button>
            <button type="button" className="secondary" aria-label={`Remove ${f.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </span>
        </li>
      ))}
    </ol>
  );
}

let seq = 0;
const nid = () => `f${++seq}`;

type Pic = { id: string; name: string; size: number; file: File };

const QUAL: Record<string, { label: string; side: number; q: number }> = {
  high: { label: 'High (large file, sharp)', side: 3200, q: 0.92 },
  medium: { label: 'Medium (good for email)', side: 2200, q: 0.85 },
  small: { label: 'Small (smallest file)', side: 1500, q: 0.72 },
};

export function ImagesToPdf() {
  const [pics, setPics] = useState<Pic[]>([]);
  const [size, setSize] = useState<PageSize>('a4');
  const [margin, setMargin] = useState(18);
  const [qual, setQual] = useState('medium');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);

  function add(files: File[]) {
    setResult(null); setError('');
    const bad: string[] = [], ok = [...pics];
    for (const f of files) {
      const p = pictureProblem(f);
      if (p) bad.push(p); else if (ok.length >= MAX_PICTURES) { bad.push(`Only ${MAX_PICTURES} pictures fit in one PDF. ${f.name} was left out.`); } else ok.push({ id: nid(), name: f.name, size: f.size, file: f });
    }
    setPics(ok); setSkipped(bad);
  }

  async function make() {
    setResult(null); setError(''); setSkipped([]);
    const q = QUAL[qual]!;
    const pages: PageImage[] = [];
    try {
      for (let i = 0; i < pics.length; i++) {
        const f = pics[i]!;
        setBusy(`Adding ${f.name} (${i + 1} of ${pics.length})`);
        await nextFrame();
        let p;
        try { p = await loadPicture(f.file); } catch { throw new Error(`${f.name} could not be read. It may be damaged. Remove it and try again.`); }
        try {
          if (p.width * p.height > LIMITS.imagePixels) throw new Error(`${f.name} is larger than 50 megapixels. Shrink it first.`);
          const k = Math.min(1, q.side / Math.max(p.width, p.height));
          const w = Math.max(1, Math.round(p.width * k)), h = Math.max(1, Math.round(p.height * k));
          const blob = await renderPicture(p, { type: 'image/jpeg', quality: q.q, width: w, height: h });
          pages.push({ bytes: await readBytes(blob), type: 'jpg', width: w, height: h });
        } finally { p.close(); }
      }
      setBusy('Building the PDF'); await nextFrame();
      const pdf = await imagesToPdf(pages, { size, margin });
      setResult({ blob: bytesOf(pdf), pages: pages.length });
    } catch (e) { setError((e as Error).message || 'The PDF could not be made. Try fewer or smaller pictures.'); } finally { setBusy(''); }
  }

  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); if (pics.length) void make(); }}>
        <FileDrop label="Choose pictures" hint="JPG, PNG or WebP, up to 50 pictures, 25 MB each. One picture per page." accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onFiles={add} />
        {pics.length > 0 && <OrderList items={pics} onChange={(n) => { setResult(null); setPics(n); }} label="Pages, in order" />}
        <label htmlFor="ip-s">Page size</label>
        <select id="ip-s" value={size} onChange={(e) => setSize(e.target.value as PageSize)}>
          <option value="a4">A4, turned to suit each picture</option>
          <option value="a4-portrait">A4 portrait</option>
          <option value="a4-landscape">A4 landscape</option>
          <option value="fit">Same size as the picture</option>
        </select>
        <label htmlFor="ip-m">Margin</label>
        <select id="ip-m" value={margin} onChange={(e) => setMargin(Number(e.target.value))}>
          <option value={0}>None</option><option value={18}>Small (6 mm)</option><option value={36}>Medium (13 mm)</option><option value={54}>Large (19 mm)</option>
        </select>
        <label htmlFor="ip-q">Picture quality</label>
        <select id="ip-q" value={qual} onChange={(e) => setQual(e.target.value)}>{Object.entries(QUAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button type="submit" disabled={!pics.length || !!busy}>Make the PDF</button>
      </form>
      <div className="tl-result">
        <Status busy={busy} error={error} note={result ? '' : pics.length ? 'Put the pictures in order, then press Make the PDF.' : 'Choose the pictures you want in the PDF.'} />
        {skipped.length > 0 && <ul className="tl-skipped" role="alert">{skipped.map((s) => <li key={s}>{s}</li>)}</ul>}
        {result && (
          <>
            <p className="tl-big">{result.pages} page{result.pages === 1 ? '' : 's'}<small>{formatBytes(result.blob.size)}. Transparent areas are shown white.</small></p>
            <div className="tl-actions"><button type="button" onClick={() => downloadBlob(result.blob, 'pictures.pdf')}>Download pictures.pdf</button></div>
          </>
        )}
        <p className="muted">{PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}

type Doc = { id: string; name: string; size: number; bytes: Uint8Array; pages: number; extra: string };
type Mode = 'merge' | 'split' | 'rotate';

export function MergeSplitPdf() {
  const [mode, setMode] = useState<Mode>('merge');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [how, setHow] = useState<'extract' | 'ranges' | 'every'>('extract');
  const [spec, setSpec] = useState('');
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [out, setOut] = useState<{ blob: Blob; name: string }[]>([]);
  const total = useRef(0);

  const single = mode !== 'merge';
  const clear = () => { setOut([]); setNote(''); setError(''); };

  async function add(files: File[]) {
    clear();
    const bad: string[] = [], ok: Doc[] = single ? [] : [...docs];
    total.current = ok.reduce((s, d) => s + d.size, 0);
    setBusy('Checking the PDFs');
    for (const f of single ? files.slice(0, 1) : files) {
      if (!/\.pdf$/i.test(f.name) && !/pdf$/i.test(f.type)) { bad.push(`${f.name} is not a PDF.`); continue; }
      if (f.size === 0) { bad.push(`${f.name} is empty.`); continue; }
      if (f.size > LIMITS.pdfBytes) { bad.push(`${f.name} is ${formatBytes(f.size)}. The limit is 100 MB for each PDF.`); continue; }
      if (ok.length >= LIMITS.pdfFiles) { bad.push(`Only ${LIMITS.pdfFiles} PDFs can be merged at once. ${f.name} was left out.`); continue; }
      if (total.current + f.size > LIMITS.totalBytes) { bad.push(`${f.name} was left out: the PDFs together are over 300 MB.`); continue; }
      try {
        const bytes = await readBytes(f);
        const pages = await pageCountOf(bytes, f.name);
        ok.push({ id: nid(), name: f.name, size: f.size, bytes, pages, extra: `${pages} page${pages === 1 ? '' : 's'}` });
        total.current += f.size;
      } catch (e) { bad.push(e instanceof PdfProblem ? e.message : `${f.name} could not be read.`); }
    }
    setBusy(''); setDocs(ok); setSkipped(bad);
  }

  async function run() {
    clear(); setSkipped([]);
    try {
      if (mode === 'merge') {
        setBusy(`Joining ${docs.length} PDFs`); await nextFrame();
        const pdf = await mergePdfs(docs);
        setOut([{ blob: bytesOf(pdf), name: 'merged.pdf' }]);
        setNote(`${docs.reduce((s, d) => s + d.pages, 0)} pages in all.`);
      } else {
        const d = docs[0]!;
        setBusy(mode === 'rotate' ? 'Turning the pages' : 'Splitting the PDF'); await nextFrame();
        const base = baseName(d.name);
        const pad = (n: number) => String(n).padStart(String(d.pages).length, '0');
        if (mode === 'rotate') {
          const pages = spec.trim() ? parsePageList(spec, d.pages) : Array.from({ length: d.pages }, (_, i) => i);
          const pdf = await rotatePages(d.bytes, [...new Set(pages)], angle, d.name);
          setOut([{ blob: bytesOf(pdf), name: `${base}-rotated.pdf` }]);
          setNote(`${new Set(pages).size} page${new Set(pages).size === 1 ? '' : 's'} turned ${angle} degrees clockwise.`);
        } else if (how === 'extract') {
          const pdf = await extractPages(d.bytes, parsePageList(spec, d.pages), d.name);
          setOut([{ blob: bytesOf(pdf), name: `${base}-extract.pdf` }]);
        } else {
          const groups = how === 'every' ? Array.from({ length: d.pages }, (_, i) => [i]) : parsePageGroups(spec, d.pages);
          const files: { name: string; blob: Blob }[] = [];
          for (let i = 0; i < groups.length; i++) {
            setBusy(`Making file ${i + 1} of ${groups.length}`); await nextFrame();
            const g = groups[i]!;
            const label = g.length === 1 ? `page-${pad(g[0]! + 1)}` : `pages-${pad(g[0]! + 1)}-${pad(g[g.length - 1]! + 1)}`;
            files.push({ name: `${base}-${label}.pdf`, blob: bytesOf(await extractPages(d.bytes, g, d.name)) });
          }
          setOut(files);
          setNote(`${files.length} PDF${files.length === 1 ? '' : 's'} made.`);
        }
      }
    } catch (e) { setError(e instanceof PdfProblem ? e.message : (e as Error).message || 'That did not work. Try a smaller PDF.'); } finally { setBusy(''); }
  }

  async function zipAll() {
    setBusy('Packing the ZIP file');
    try { downloadBlob(await makeZip(await Promise.all(out.map(async (o) => ({ name: o.name, data: await readBytes(o.blob) })))), `${baseName(docs[0]!.name)}-split.zip`); }
    catch { setError('The ZIP file could not be made. Download the files one by one instead.'); } finally { setBusy(''); }
  }

  const needSpec = mode === 'split' && how !== 'every';
  const canRun = docs.length > 0 && !busy && (mode !== 'merge' || docs.length >= 2) && (!needSpec || spec.trim() !== '');
  const MODES: [Mode, string][] = [['merge', 'Merge PDFs'], ['split', 'Split or extract'], ['rotate', 'Rotate pages']];

  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); if (canRun) void run(); }}>
        <fieldset className="tl-fs"><legend>What do you want to do?</legend>
          <div className="tl-chips" role="radiogroup" aria-label="What to do">
            {MODES.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? '' : 'secondary'} onClick={() => { setMode(m); clear(); setSkipped([]); if (m !== 'merge') setDocs(docs.slice(0, 1)); }}>{l}</button>)}
          </div>
        </fieldset>
        <FileDrop key={mode === 'merge' ? 'm' : 's'} label={single ? 'Choose a PDF' : 'Choose PDFs to join'} hint={single ? 'One PDF, up to 100 MB.' : 'Two or more PDFs, up to 20 files. Add them in any order and arrange them below.'} accept="application/pdf,.pdf" multiple={!single} onFiles={(f) => void add(f)} />
        {docs.length > 0 && (single
          ? <p className="tl-file"><b>{docs[0]!.name}</b><span>{docs[0]!.extra}, {formatBytes(docs[0]!.size)}</span></p>
          : <OrderList items={docs} onChange={(n) => { clear(); setDocs(n); }} label="PDFs, in order" />)}
        {mode === 'split' && docs.length > 0 && (
          <fieldset className="tl-fs"><legend>How</legend>
            <div className="tl-stack">
              <label className="tl-check"><input type="radio" name="sp" checked={how === 'extract'} onChange={() => setHow('extract')} /> Pick pages into one new PDF</label>
              <label className="tl-check"><input type="radio" name="sp" checked={how === 'ranges'} onChange={() => setHow('ranges')} /> One PDF for each range</label>
              <label className="tl-check"><input type="radio" name="sp" checked={how === 'every'} onChange={() => setHow('every')} /> One PDF for every page</label>
            </div>
          </fieldset>
        )}
        {(needSpec || mode === 'rotate') && docs.length > 0 && (
          <>
            <label htmlFor="ms-r">{mode === 'rotate' ? 'Pages to turn (leave empty for all)' : 'Pages'}</label>
            <input id="ms-r" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={how === 'ranges' && mode === 'split' ? 'for example 1-3, 4-6, 7-' : 'for example 1-3, 5, 8-'} autoComplete="off" aria-describedby="ms-h" />
            <p id="ms-h" className="muted">{docs[0]!.pages} page{docs[0]!.pages === 1 ? '' : 's'} in this PDF.{how === 'ranges' && mode === 'split' ? ' Each comma-separated part becomes its own file.' : mode === 'split' ? ' Pages come out in the order you type them, so 3,1 puts page 3 first.' : ''}</p>
          </>
        )}
        {mode === 'rotate' && docs.length > 0 && (
          <>
            <label htmlFor="ms-a">Turn clockwise</label>
            <select id="ms-a" value={angle} onChange={(e) => setAngle(Number(e.target.value) as 90 | 180 | 270)}><option value={90}>90 degrees</option><option value={180}>180 degrees (upside down)</option><option value={270}>270 degrees (90 anticlockwise)</option></select>
          </>
        )}
        <button type="submit" disabled={!canRun}>{mode === 'merge' ? 'Merge the PDFs' : mode === 'rotate' ? 'Rotate and save' : how === 'extract' ? 'Extract the pages' : 'Split the PDF'}</button>
        {mode === 'merge' && docs.length === 1 && <p className="muted">Add one more PDF to merge.</p>}
      </form>
      <div className="tl-result">
        <Status busy={busy} error={error} note={note || (docs.length ? '' : mode === 'merge' ? 'Choose two or more PDFs to join into one.' : 'Choose a PDF to work on.')} />
        {skipped.length > 0 && <ul className="tl-skipped" role="alert">{skipped.map((s) => <li key={s}>{s}</li>)}</ul>}
        {out.length > 0 && (
          <>
            <div className="tl-actions">
              {out.length > 1 ? <button type="button" disabled={!!busy} onClick={() => void zipAll()}>Download all as ZIP</button> : <button type="button" onClick={() => downloadBlob(out[0]!.blob, out[0]!.name)}>Download {out[0]!.name}</button>}
            </div>
            <ul className="tl-files tl-out">
              {out.map((o) => <li key={o.name}><span>{o.name}</span><small>{formatBytes(o.blob.size)}</small>{out.length > 1 && <button type="button" className="secondary" aria-label={`Download ${o.name}`} onClick={() => downloadBlob(o.blob, o.name)}>Download</button>}</li>)}
            </ul>
          </>
        )}
        <p className="muted">{PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}
