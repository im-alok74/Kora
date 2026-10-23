'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { baseName, downloadBlob, LIMITS, makeZip, nextFrame, readBytes } from '../../lib/browserFiles';
import { parsePageList, PdfProblem } from '../../lib/pdfPages';
import { openPdf, pageToBlob, PdfOpenError } from '../../lib/pdfRender';
import { formatBytes } from '../../lib/sizeTarget';
import { FileDrop, PRIVATE_NOTE, Status } from './ToolBits';

type Out = { n: number; name: string; blob: Blob; url: string; width: number; height: number };
const QUALITY: [string, number][] = [['Screen (100 dpi)', 100 / 72], ['Standard (150 dpi)', 150 / 72], ['High (200 dpi)', 200 / 72], ['Print (300 dpi)', 300 / 72]];

export default function PdfToImage() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pages, setPages] = useState(0);
  const [password, setPassword] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const [format, setFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [scale, setScale] = useState(150 / 72);
  const [range, setRange] = useState('');
  const [outs, setOuts] = useState<Out[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const doc = useRef<PDFDocumentProxy | null>(null);
  const stop = useRef(false);
  const urls = useRef<string[]>([]);

  const clearOuts = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; setOuts([]); };
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); void doc.current?.loadingTask.destroy(); }, []);

  async function open(bytes: Uint8Array, name: string, pw?: string) {
    setBusy('Opening the PDF'); setError(''); setNote('');
    try {
      void doc.current?.loadingTask.destroy();
      doc.current = await openPdf(bytes, pw);
      setPages(doc.current.numPages); setNeedPw(false); setFile({ name, bytes });
      if (doc.current.numPages > LIMITS.pdfPages) setNote(`This PDF has ${doc.current.numPages} pages. Up to ${LIMITS.pdfPages} pages can be turned into pictures at a time, so choose a page range.`);
    } catch (e) {
      doc.current = null; setPages(0);
      if (e instanceof PdfOpenError && e.reason !== 'broken') { setNeedPw(true); setFile({ name, bytes }); }
      else setFile(null);
      setError((e as Error).message);
    } finally { setBusy(''); }
  }

  async function choose(files: File[]) {
    const f = files[0]!;
    clearOuts(); setRange(''); setPassword('');
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { setError(`${f.name} is not a PDF. Choose a file that ends in .pdf.`); return; }
    if (f.size === 0) { setError(`${f.name} is empty.`); return; }
    if (f.size > LIMITS.pdfBytes) { setError(`${f.name} is ${formatBytes(f.size)}. The limit is 100 MB, to keep your browser from running out of memory.`); return; }
    await open(await readBytes(f), f.name);
  }

  async function convert() {
    if (!doc.current || !file) return;
    let list: number[];
    try { list = range.trim() ? [...new Set(parsePageList(range, pages))].map((i) => i + 1) : Array.from({ length: pages }, (_, i) => i + 1); } catch (e) { setError(e instanceof PdfProblem ? e.message : 'Check the page range.'); return; }
    if (list.length > LIMITS.pdfPages) { setError(`That is ${list.length} pages. Choose at most ${LIMITS.pdfPages} at a time, for example 1-${LIMITS.pdfPages}.`); return; }
    clearOuts(); setError(''); setNote(''); stop.current = false;
    const made: Out[] = [];
    let reducedAny = false;
    try {
      for (let i = 0; i < list.length; i++) {
        if (stop.current) break;
        if (i % 5 === 0) setBusy(`Drawing page ${list[i]} (${i + 1} of ${list.length})`);   // screen readers hear every fifth page, not every one
        await nextFrame();
        const r = await pageToBlob(doc.current, list[i]!, { scale, type: format, quality: 0.9 });
        reducedAny ||= r.reduced;
        const url = URL.createObjectURL(r.blob); urls.current.push(url);
        const ext = format === 'image/png' ? 'png' : 'jpg';
        made.push({ n: list[i]!, name: `${baseName(file.name)}-page-${String(list[i]).padStart(String(pages).length, '0')}.${ext}`, blob: r.blob, url, width: r.width, height: r.height });
        setOuts([...made]);
      }
      setNote(`${stop.current ? 'Stopped. ' : ''}${made.length} picture${made.length === 1 ? '' : 's'} ready.${reducedAny ? ' Some pages are very large, so they were drawn a little smaller than the quality you chose.' : ''}`);
    } catch (e) {
      setError(`Page conversion stopped: ${(e as Error).message || 'the browser ran out of memory'}. Try a lower quality or fewer pages.`);
    } finally { setBusy(''); }
  }

  async function zipAll() {
    setBusy('Packing the ZIP file');
    try {
      const files = await Promise.all(outs.map(async (o) => ({ name: o.name, data: await readBytes(o.blob) })));
      downloadBlob(await makeZip(files), `${baseName(file!.name)}-pages.zip`);
    } catch { setError('The ZIP file could not be made. Download the pictures one by one instead.'); } finally { setBusy(''); }
  }

  const total = outs.reduce((s, o) => s + o.blob.size, 0);
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); void convert(); }}>
        <FileDrop label="Choose a PDF" hint="Or drop it here. Up to 100 MB." accept="application/pdf,.pdf" onFiles={(f) => void choose(f)} />
        {needPw && file && (
          <>
            <label htmlFor="pdf-pw">Password for {file.name}</label>
            <input id="pdf-pw" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" disabled={!password || !!busy} onClick={() => void open(file.bytes, file.name, password)}>Unlock the PDF</button>
          </>
        )}
        {pages > 0 && (
          <>
            <p className="tl-file"><b>{file?.name}</b><span>{pages} page{pages === 1 ? '' : 's'}, {formatBytes(file!.bytes.length)}</span></p>
            <fieldset className="tl-fs"><legend>Save pages as</legend>
              <div className="tl-seg">
                <label className="tl-check"><input type="radio" name="pf" checked={format === 'image/png'} onChange={() => setFormat('image/png')} /> PNG (sharp, larger)</label>
                <label className="tl-check"><input type="radio" name="pf" checked={format === 'image/jpeg'} onChange={() => setFormat('image/jpeg')} /> JPG (smaller)</label>
              </div>
            </fieldset>
            <label htmlFor="pq">Quality</label>
            <select id="pq" value={scale} onChange={(e) => setScale(Number(e.target.value))}>{QUALITY.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select>
            <label htmlFor="pr">Pages (leave empty for all)</label>
            <input id="pr" value={range} onChange={(e) => setRange(e.target.value)} placeholder="for example 1-3, 5, 8-" autoComplete="off" />
            <div className="tl-actions">
              <button type="submit" disabled={!!busy}>Convert to {format === 'image/png' ? 'PNG' : 'JPG'}</button>
              {busy.startsWith('Drawing') && <button type="button" className="secondary" onClick={() => { stop.current = true; }}>Stop</button>}
            </div>
          </>
        )}
      </form>
      <div className="tl-result">
        <Status busy={busy} error={error} note={note || (pages === 0 ? 'Choose a PDF to turn its pages into pictures.' : '')} />
        {outs.length > 0 && (
          <>
            <div className="tl-actions">
              {outs.length > 1 && <button type="button" disabled={!!busy} onClick={() => void zipAll()}>Download all as ZIP ({formatBytes(total)})</button>}
              {outs.length === 1 && <button type="button" onClick={() => downloadBlob(outs[0]!.blob, outs[0]!.name)}>Download the picture</button>}
            </div>
            <ul className="tl-thumbs">
              {outs.map((o) => (
                <li key={o.n}>
                  <img src={o.url} alt={`Page ${o.n} as a picture`} loading="lazy" />
                  <span>Page {o.n}, {o.width} x {o.height}, {formatBytes(o.blob.size)}</span>
                  <a href={o.url} download={o.name} aria-label={`Download page ${o.n}`}>Download</a>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted">{PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}
