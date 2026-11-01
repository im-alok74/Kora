'use client';
import { useEffect, useRef, useState } from 'react';
import { EXT, LIMITS, baseName, downloadBlob, formatOf, pictureProblem, type ImageFormat } from '../../lib/browserFiles';
import { LOGO_MAX_KB, fitLogo } from '../../lib/imageWork';
import { formatBytes } from '../../lib/sizeTarget';
import { FileDrop, PRIVATE_NOTE, Status } from './ToolBits';

type Fitted = { blob: Blob; url: string; width: number; height: number; note: string; met: boolean };

/**
 * For a logo you already have: brings it under the 150 KB Kora accepts for an invoice logo. A PNG or JPG keeps its type; a WebP
 * becomes a JPG. This is the only picture tool left on the site, and it exists because the logo upload in Kora has that limit.
 */
export default function LogoFit() {
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState('');
  const [res, setRes] = useState<Fitted | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  const keep = (blob: Blob) => { const u = URL.createObjectURL(blob); urls.current.push(u); return u; };

  async function choose(files: File[]) {
    const f = files[0]!;
    setRes(null); setError('');
    const bad = pictureProblem(f);
    if (bad) { setFile(null); setSrcUrl(''); setError(bad); return; }
    setFile(f); setSrcUrl(keep(f)); setBusy('Making the logo smaller');
    try {
      const type: ImageFormat = formatOf(f) === 'image/webp' ? 'image/jpeg' : formatOf(f);
      const r = await fitLogo(f, f.name, { type, maxPixels: LIMITS.imagePixels }, setBusy);
      setRes({ ...r, url: keep(r.blob) });
    } catch (e) { setError((e as Error).message || 'The logo could not be processed. Try a smaller picture.'); } finally { setBusy(''); }
  }

  const name = file && res ? `${baseName(file.name)}-kora-logo.${EXT[res.blob.type as ImageFormat] ?? 'png'}` : '';
  return (
    <section className="tl-logofit" aria-labelledby="logofit-h">
      <h3 id="logofit-h" className="tl-sub">Already have a logo? Fit it for Kora</h3>
      <p className="muted">Kora takes a PNG or JPG logo under {LOGO_MAX_KB} KB. Choose yours and we shrink it to fit (a WebP logo becomes a JPG).</p>
      <div className="tl-calc">
        <div className="tl-form">
          <FileDrop id="logo-file" label="Choose your logo" hint="JPG, PNG or WebP, up to 25 MB." accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onFiles={(f) => void choose(f)} />
          {file && <p className="tl-file"><b>{file.name}</b><span>{formatBytes(file.size)}</span></p>}
        </div>
        <div className="tl-result">
          <Status busy={busy} error={error || (res && !res.met ? res.note : '')} note={res ? (res.met ? res.note : '') : file ? '' : 'Choose a logo to fit.'} />
          {res && file && (
            <>
              <p className="tl-big">{formatBytes(res.blob.size)}<small>was {formatBytes(file.size)}, now {res.width} x {res.height}</small></p>
              <div className="tl-compare">
                <figure><img src={srcUrl} alt="Your original logo" /><figcaption>Before: {formatBytes(file.size)}</figcaption></figure>
                <figure><img src={res.url} alt="Your logo fitted for Kora" /><figcaption>After: {res.width} x {res.height}, {formatBytes(res.blob.size)}</figcaption></figure>
              </div>
              <div className="tl-actions"><button type="button" onClick={() => downloadBlob(res.blob, name)}>Download {name}</button></div>
            </>
          )}
          <p className="muted">{PRIVATE_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
