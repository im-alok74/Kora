'use client';
import { useEffect, useRef, useState } from 'react';
import { baseName, downloadBlob, EXT, LIMITS, loadPicture, makeZip, nextFrame, pictureProblem, readBytes, renderPicture, uniqueName, type ImageFormat, type Picture } from '../../lib/browserFiles';
import { fitToSize, formatBytes } from '../../lib/sizeTarget';
import { FileDrop, PRIVATE_NOTE, Status } from './ToolBits';

const FORMATS: [ImageFormat, string][] = [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']];
const formatOf = (f: File): ImageFormat => (f.type === 'image/png' || /\.png$/i.test(f.name) ? 'image/png' : f.type === 'image/webp' || /\.webp$/i.test(f.name) ? 'image/webp' : 'image/jpeg');

/** Decode a picture, refusing ones too large to hold in memory. */
async function decode(f: File): Promise<Picture> {
  const p = await loadPicture(f);
  if (p.width * p.height > LIMITS.imagePixels) { p.close(); throw new Error(`${f.name} is ${p.width} x ${p.height} pixels, which is too large for the browser to handle safely. Shrink it first (the limit is 50 megapixels).`); }
  return p;
}

type Done = { name: string; from: number; blob: Blob; url: string; fromFormat: string };

export function ImageConverter() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [quality, setQuality] = useState(85);
  const [done, setDone] = useState<Done[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const urls = useRef<string[]>([]);
  const reset = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; setDone([]); };
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  function add(picked: File[]) {
    reset(); setError(''); setNote('');
    const ok: File[] = [], bad: string[] = [];
    for (const f of [...files, ...picked]) { const p = pictureProblem(f); if (p) bad.push(p); else ok.push(f); }
    if (ok.length > LIMITS.imageFiles) { bad.push(`Only the first ${LIMITS.imageFiles} pictures are kept in one batch.`); ok.length = LIMITS.imageFiles; }
    setFiles(ok); setSkipped([...new Set(bad)]);
  }

  async function convert() {
    reset(); setError(''); setNote('');
    const out: Done[] = [], used = new Set<string>(), failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setBusy(`Converting ${f.name} (${i + 1} of ${files.length})`);
      await nextFrame();
      let p: Picture | undefined;
      try {
        p = await decode(f);
        const blob = await renderPicture(p, { type: format, quality: format === 'image/png' ? undefined : quality / 100 });
        const url = URL.createObjectURL(blob); urls.current.push(url);
        out.push({ name: uniqueName(`${baseName(f.name)}.${EXT[format]}`, used), from: f.size, blob, url, fromFormat: FORMATS.find(([t]) => t === formatOf(f))![1] });
        setDone([...out]);
      } catch (e) { const m = (e as Error).message; failed.push(m.includes(f.name) ? m : `${f.name}: ${m || 'could not be read. It may be damaged.'}`); } finally { p?.close(); }
    }
    setBusy(''); setSkipped(failed);
    setNote(out.length ? `${out.length} picture${out.length === 1 ? '' : 's'} converted.${format === 'image/jpeg' ? ' Transparent areas became white, because JPG has no transparency.' : ''}` : '');
  }

  async function zipAll() {
    setBusy('Packing the ZIP file');
    try { downloadBlob(await makeZip(await Promise.all(done.map(async (d) => ({ name: d.name, data: await readBytes(d.blob) })))), 'converted-pictures.zip'); }
    catch { setError('The ZIP file could not be made. Download the pictures one by one instead.'); } finally { setBusy(''); }
  }

  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); if (files.length) void convert(); }}>
        <FileDrop label="Choose pictures" hint="JPG, PNG or WebP. Up to 30 pictures, 25 MB each." accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onFiles={add} />
        {files.length > 0 && (
          <ul className="tl-files" aria-label="Chosen pictures">
            {files.map((f, i) => <li key={`${f.name}${i}`}><span>{f.name}</span><small>{formatBytes(f.size)}</small><button type="button" className="secondary" aria-label={`Remove ${f.name}`} onClick={() => { reset(); setFiles(files.filter((_, j) => j !== i)); }}>Remove</button></li>)}
          </ul>
        )}
        <fieldset className="tl-fs"><legend>Convert to</legend>
          <div className="tl-chips" role="radiogroup" aria-label="Output format">
            {FORMATS.map(([t, l]) => <button key={t} type="button" role="radio" aria-checked={format === t} className={format === t ? '' : 'secondary'} onClick={() => setFormat(t)}>{l}</button>)}
          </div>
        </fieldset>
        <label htmlFor="ic-q">Quality: {format === 'image/png' ? 'not used for PNG (it is lossless)' : `${quality}%`}</label>
        <input id="ic-q" type="range" min={30} max={100} step={5} value={quality} disabled={format === 'image/png'} onChange={(e) => setQuality(Number(e.target.value))} />
        <button type="submit" disabled={!files.length || !!busy}>Convert {files.length > 1 ? `${files.length} pictures` : 'picture'}</button>
      </form>
      <div className="tl-result">
        <Status busy={busy} error={error} note={note || (!files.length ? 'Choose one or more pictures to convert.' : done.length ? '' : 'Pick the format and press Convert.')} />
        {skipped.length > 0 && <ul className="tl-skipped" role="alert">{skipped.map((s) => <li key={s}>{s}</li>)}</ul>}
        {done.length > 0 && (
          <>
            {done.length > 1 && <div className="tl-actions"><button type="button" disabled={!!busy} onClick={() => void zipAll()}>Download all as ZIP</button></div>}
            <ul className="tl-thumbs">
              {done.map((d) => (
                <li key={d.name}>
                  <img src={d.url} alt={`${d.name}, converted`} loading="lazy" />
                  <span>{d.name}: {d.fromFormat} {formatBytes(d.from)} to {formatBytes(d.blob.size)}</span>
                  <a href={d.url} download={d.name} aria-label={`Download ${d.name}`}>Download</a>
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

type Mode = 'size' | 'dimensions';
type Result = { blob: Blob; url: string; width: number; height: number; note: string; met: boolean };

export function ImageCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState('');
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<Mode>('size');
  const [kb, setKb] = useState('150');
  const [out, setOut] = useState<ImageFormat | 'same'>('same');
  const [w, setW] = useState(''), [h, setH] = useState('');
  const [lock, setLock] = useState(true);
  const [quality, setQuality] = useState(80);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pic = useRef<Picture | null>(null);
  const resUrl = useRef('');
  const srcRef = useRef('');
  useEffect(() => () => { pic.current?.close(); if (resUrl.current) URL.revokeObjectURL(resUrl.current); if (srcRef.current) URL.revokeObjectURL(srcRef.current); }, []);

  const drop = () => { if (resUrl.current) URL.revokeObjectURL(resUrl.current); resUrl.current = ''; setRes(null); };

  async function choose(files: File[]) {
    const f = files[0]!;
    drop(); setError('');
    const bad = pictureProblem(f);
    if (bad) { setError(bad); return; }
    setBusy('Reading the picture');
    try {
      const p = await decode(f);
      pic.current?.close(); pic.current = p;
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
      srcRef.current = URL.createObjectURL(f);
      setFile(f); setSrcUrl(srcRef.current); setDims({ w: p.width, h: p.height }); setW(String(p.width)); setH(String(p.height)); setOut('same');
    } catch (e) { setError((e as Error).message || `${f.name} could not be read. It may be damaged.`); } finally { setBusy(''); }
  }

  async function run(s: { mode: Mode; kb: number; out: ImageFormat | 'same'; w: number; h: number; quality: number }) {
    if (!file || !pic.current) return;
    drop(); setError(''); setBusy('Making the smaller picture'); await nextFrame();
    const type: ImageFormat = s.out === 'same' ? formatOf(file) : s.out;
    const p = pic.current;
    try {
      let blob: Blob, width: number, height: number, note = '', met = true;
      if (s.mode === 'size') {
        const r = await fitToSize(async (scale, q) => { const b = await renderPicture(p, { type, quality: q ?? undefined, scale }); return { out: b, size: b.size }; }, s.kb * 1024, { lossy: type !== 'image/png' });
        blob = r.out; width = Math.round(p.width * r.scale); height = Math.round(p.height * r.scale); met = r.met;
        note = r.met ? `Fits under ${s.kb} KB${r.scale < 1 ? `, with the picture made ${Math.round((1 - r.scale) * 100)}% smaller in each direction` : ''}.` : `Could not reach ${s.kb} KB without making the picture tiny. This is the smallest we could make. Try JPG or WebP, or a higher limit.`;
        if (r.met && blob.size > file.size) note += ' This is larger than your original, which was already under the limit. Keep the original.';
      } else {
        width = s.w; height = s.h;
        blob = await renderPicture(p, { type, quality: type === 'image/png' ? undefined : s.quality / 100, width, height });
        note = blob.size > file.size ? 'The new picture is larger than the original. Lower the quality or the size.' : '';
      }
      const url = URL.createObjectURL(blob); resUrl.current = url;
      setRes({ blob, url, width, height, note, met });
    } catch (e) { setError((e as Error).message || 'The picture could not be processed. Try a smaller one.'); } finally { setBusy(''); }
  }

  const num = (v: string) => (/^\d{1,5}$/.test(v) ? Number(v) : 0);
  const dimsOk = num(w) >= 1 && num(h) >= 1 && num(w) <= 10000 && num(h) <= 10000;
  const kbOk = Number(kb) >= 5 && Number(kb) <= 20000;
  const setWidth = (v: string) => { setW(v); if (lock && num(v) && dims.w) setH(String(Math.max(1, Math.round((num(v) * dims.h) / dims.w)))); };
  const setHeight = (v: string) => { setH(v); if (lock && num(v) && dims.h) setW(String(Math.max(1, Math.round((num(v) * dims.w) / dims.h)))); };
  const ext = res ? EXT[res.blob.type as ImageFormat] : '';
  const outName = file && res ? `${baseName(file.name)}-small.${ext}` : '';

  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); if (file) void run({ mode, kb: Number(kb), out, w: num(w), h: num(h), quality }); }}>
        <FileDrop label="Choose a picture" hint="JPG, PNG or WebP, up to 25 MB." accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onFiles={(f) => void choose(f)} />
        {file && (
          <>
            <p className="tl-file"><b>{file.name}</b><span>{dims.w} x {dims.h}, {formatBytes(file.size)}</span></p>
            <p className="muted">Kora accepts a PNG or JPG logo under 150 KB. This button sets that up for you (a WebP logo becomes a JPG).</p>
            <div className="tl-actions">
              <button type="button" disabled={!!busy} onClick={() => { const o = formatOf(file) === 'image/webp' ? 'image/jpeg' : 'same'; setMode('size'); setKb('150'); setOut(o); void run({ mode: 'size', kb: 150, out: o, w: 0, h: 0, quality }); }}>Kora invoice logo (under 150 KB)</button>
            </div>
            <fieldset className="tl-fs"><legend>Shrink by</legend>
              <div className="tl-seg">
                <label className="tl-check"><input type="radio" name="cm" checked={mode === 'size'} onChange={() => setMode('size')} /> Target file size</label>
                <label className="tl-check"><input type="radio" name="cm" checked={mode === 'dimensions'} onChange={() => setMode('dimensions')} /> Width and height</label>
              </div>
            </fieldset>
            {mode === 'size' ? (
              <>
                <label htmlFor="ck">Largest file size (KB)</label>
                <input id="ck" inputMode="numeric" value={kb} onChange={(e) => setKb(e.target.value.replace(/\D/g, ''))} aria-invalid={!kbOk} aria-describedby="ck-h" />
                <p id="ck-h" className="muted">Between 5 and 20000 KB. We lower the quality first, then the size, until it fits.</p>
              </>
            ) : (
              <>
                <div className="tl-row">
                  <div><label htmlFor="cw">Width (px)</label><input id="cw" inputMode="numeric" value={w} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))} /></div>
                  <div><label htmlFor="ch">Height (px)</label><input id="ch" inputMode="numeric" value={h} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} /></div>
                </div>
                <label className="tl-check"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep the proportions</label>
                {!dimsOk && <p className="error">Enter a width and height between 1 and 10000.</p>}
                <label htmlFor="cq">Quality: {out === 'image/png' || (out === 'same' && formatOf(file) === 'image/png') ? 'not used for PNG' : `${quality}%`}</label>
                <input id="cq" type="range" min={30} max={100} step={5} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              </>
            )}
            <label htmlFor="co">Save as</label>
            <select id="co" value={out} onChange={(e) => setOut(e.target.value as ImageFormat | 'same')}>
              <option value="same">Same type as the original</option>
              {FORMATS.map(([t, l]) => <option key={t} value={t}>{l}{t === 'image/png' && mode === 'size' ? ' (only the size can change)' : ''}</option>)}
            </select>
            <button type="submit" disabled={!!busy || (mode === 'size' ? !kbOk : !dimsOk)}>Make it smaller</button>
          </>
        )}
      </form>
      <div className="tl-result">
        <Status busy={busy} error={error || (res && !res.met ? res.note : '')} note={res ? (res.met ? res.note : '') : file ? '' : 'Choose a picture to shrink.'} />
        {res && file && (
          <>
            <p className="tl-big">{formatBytes(res.blob.size)}<small>was {formatBytes(file.size)}{res.blob.size < file.size ? `, ${Math.round((1 - res.blob.size / file.size) * 100)}% smaller` : ''}, now {res.width} x {res.height}</small></p>
            <div className="tl-compare">
              <figure><img src={srcUrl} alt="Original picture" /><figcaption>Before: {dims.w} x {dims.h}, {formatBytes(file.size)}</figcaption></figure>
              <figure><img src={res.url} alt="Smaller picture" /><figcaption>After: {res.width} x {res.height}, {formatBytes(res.blob.size)}</figcaption></figure>
            </div>
            <div className="tl-actions"><button type="button" onClick={() => downloadBlob(res.blob, outName)}>Download {outName}</button></div>
          </>
        )}
        <p className="muted">{PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}
