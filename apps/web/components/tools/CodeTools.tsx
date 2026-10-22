'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { code128Svg } from '../../lib/code128';

const download = (href: string, name: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };

type QrKind = 'text' | 'url' | 'phone' | 'upi' | 'wifi';
export function QrGenerator() {
  const [kind, setKind] = useState<QrKind>('url');
  const [a, setA] = useState(''), [b, setB] = useState(''), [c, setC] = useState('');
  const [size, setSize] = useState(320);
  const [img, setImg] = useState('');
  const [err, setErr] = useState('');
  const payload = kind === 'upi' ? (a ? `upi://pay?pa=${encodeURIComponent(a.trim())}${b ? `&pn=${encodeURIComponent(b)}` : ''}${c ? `&am=${encodeURIComponent(c)}` : ''}&cu=INR` : '')
    : kind === 'phone' ? (a ? `tel:${a.replace(/[^\d+]/g, '')}` : '')
    : kind === 'wifi' ? (a ? `WIFI:T:WPA;S:${a.replace(/([\\;,:"])/g, '\\$1')};P:${b.replace(/([\\;,:"])/g, '\\$1')};;` : '')
    : a;
  useEffect(() => {
    if (!payload) { setImg(''); setErr(''); return; }
    QRCode.toDataURL(payload, { width: size, margin: 2, errorCorrectionLevel: 'M' }).then((u) => { setImg(u); setErr(''); }).catch(() => { setImg(''); setErr('That is too long for a QR code. Shorten it.'); });
  }, [payload, size]);
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="qk">What is it for?</label>
        <select id="qk" value={kind} onChange={(e) => { setKind(e.target.value as QrKind); setA(''); setB(''); setC(''); }}>
          <option value="url">A web link</option><option value="text">Plain text</option><option value="phone">A phone number</option><option value="upi">A UPI payment</option><option value="wifi">Wi-Fi sign-in</option>
        </select>
        {kind === 'upi' ? (<>
          <label htmlFor="qa">UPI ID</label><input id="qa" value={a} onChange={(e) => setA(e.target.value)} placeholder="name@bank" autoCapitalize="none" />
          <label htmlFor="qb">Name to show (optional)</label><input id="qb" value={b} onChange={(e) => setB(e.target.value)} />
          <label htmlFor="qc">Amount in Rs (optional)</label><input id="qc" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} />
        </>) : kind === 'wifi' ? (<>
          <label htmlFor="qa">Network name</label><input id="qa" value={a} onChange={(e) => setA(e.target.value)} />
          <label htmlFor="qb">Password</label><input id="qb" value={b} onChange={(e) => setB(e.target.value)} />
        </>) : (<>
          <label htmlFor="qa">{kind === 'url' ? 'Web address' : kind === 'phone' ? 'Phone number' : 'Text'}</label>
          {kind === 'text' ? <textarea id="qa" rows={4} value={a} onChange={(e) => setA(e.target.value)} /> : <input id="qa" value={a} onChange={(e) => setA(e.target.value)} placeholder={kind === 'url' ? 'https://example.com' : '+91 98765 43210'} />}
        </>)}
        <label htmlFor="qs">Size: {size} px</label>
        <input id="qs" type="range" min={160} max={800} step={40} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {err ? <p className="error">{err}</p> : img ? (<><img src={img} alt="Your QR code" width={Math.min(size, 360)} height={Math.min(size, 360)} className="tl-img" /><div className="tl-actions"><button type="button" onClick={() => download(img, 'qr-code.png')}>Download PNG</button></div></>) : <p className="muted">Fill in the details to make a QR code.</p>}
        <p className="muted">Made on your device. Test the code with a phone before you print it.</p>
      </div>
    </div>
  );
}

export function BarcodeGenerator() {
  const [text, setText] = useState('');
  const [h, setH] = useState(90);
  let svg = '', err = '';
  if (text) { try { svg = code128Svg(text, { height: h, moduleWidth: 2 }); } catch (e) { err = (e as Error).message; } }
  const png = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.width * 2; c.height = im.height * 2; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); download(c.toDataURL('image/png'), 'barcode.png'); URL.revokeObjectURL(url); };
    im.src = url;
  };
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="bt">Code to encode</label>
        <input id="bt" value={text} onChange={(e) => setText(e.target.value)} placeholder="SKU-10042 or 8901234567890" maxLength={40} />
        <label htmlFor="bh">Height: {h} px</label>
        <input id="bh" type="range" min={50} max={200} step={10} value={h} onChange={(e) => setH(Number(e.target.value))} />
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {err ? <p className="error">{err}</p> : svg ? (<><img className="tl-img" alt={`Code 128 barcode for ${text}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /><div className="tl-actions"><button type="button" onClick={png}>Download PNG</button><button type="button" className="secondary" onClick={() => download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), 'barcode.svg')}>Download SVG</button></div></>) : <p className="muted">Type a code to see the barcode.</p>}
        <p className="muted">Code 128 works with most scanners. For retail EAN or UPC codes, use the numbers your product registration gives you.</p>
      </div>
    </div>
  );
}

type Detector = { detect(src: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]> };
declare global { interface Window { BarcodeDetector?: { new (o?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } } }

/** Reads codes with the browser's own detector (Chrome, Edge and Android). Nothing is uploaded. */
export function ScanTool({ mode }: { mode: 'qr' | 'barcode' }) {
  const [found, setFound] = useState<{ value: string; format: string }[] | null>(null);
  const [msg, setMsg] = useState('');
  const [live, setLive] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<() => void>(() => {});
  const supported = typeof window !== 'undefined' && !!window.BarcodeDetector;
  const make = async () => { const D = window.BarcodeDetector!; const fm = D.getSupportedFormats ? await D.getSupportedFormats() : undefined; const want = mode === 'qr' ? ['qr_code'] : fm?.filter((f) => f !== 'qr_code'); return new D(want && want.length ? { formats: want } : undefined); };

  const fromFile = async (f: File | undefined) => {
    setFound(null); setMsg('');
    if (!f) return;
    if (!window.BarcodeDetector) { setMsg('This browser cannot read codes from images. Try Chrome or Edge, or a phone with a recent Android or Chrome.'); return; }
    try {
      const bmp = await createImageBitmap(f);
      const r = await (await make()).detect(bmp);
      setFound(r.map((x) => ({ value: x.rawValue, format: x.format })));
      if (!r.length) setMsg(`No ${mode === 'qr' ? 'QR code' : 'barcode'} found. Use a sharper, brighter picture with the whole code in view.`);
    } catch { setMsg('That file could not be read as a picture.'); }
  };
  const start = async () => {
    setMsg(''); setFound(null);
    if (!window.BarcodeDetector) { setMsg('This browser cannot scan live. Upload a picture instead.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = video.current!; v.srcObject = stream; await v.play(); setLive(true);
      const det = await make(); let on = true;
      stop.current = () => { on = false; stream.getTracks().forEach((t) => t.stop()); setLive(false); };
      const tick = async () => { if (!on) return; try { const r = await det.detect(v); if (r.length) { setFound(r.map((x) => ({ value: x.rawValue, format: x.format }))); stop.current(); return; } } catch { /* keep trying */ } setTimeout(tick, 250); };
      void tick();
    } catch { setMsg('The camera could not be opened. Allow camera access, or upload a picture instead.'); }
  };
  useEffect(() => () => stop.current(), []);
  const label = mode === 'qr' ? 'QR code' : 'barcode';
  return (
    <div className="tl-calc">
      <div className="tl-form">
        <label htmlFor="sf">Choose a picture with a {label}</label>
        <input id="sf" type="file" accept="image/*" onChange={(e) => void fromFile(e.target.files?.[0])} />
        {mode === 'barcode' && <div className="tl-actions"><button type="button" onClick={() => (live ? stop.current() : void start())}>{live ? 'Stop the camera' : 'Scan with the camera'}</button></div>}
        <video ref={video} className={live ? 'tl-video' : 'sr-only'} muted playsInline aria-label="Camera view" />
        {!supported && <p className="muted">Your browser may not support reading codes. If nothing happens, try Chrome or Edge.</p>}
      </div>
      <div className="tl-result" role="status" aria-live="polite">
        {msg && <p className="error">{msg}</p>}
        {found && found.length > 0 && found.map((f, i) => (
          <div key={i} className="tl-found"><span className="small">{f.format.replace('_', ' ')}</span><code>{f.value}</code>
            <div className="tl-actions"><button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(f.value)}>Copy</button>{/^https?:\/\//.test(f.value) && <a className="btn secondary" href={f.value} target="_blank" rel="noopener noreferrer">Open link</a>}</div></div>
        ))}
        {!msg && !found && <p className="muted">The result shows here. The picture stays on your device.</p>}
      </div>
    </div>
  );
}
