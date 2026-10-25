'use client';

import { useEffect, useRef, useState } from 'react';

const PAPER = 800;   // the width a printed document is laid out at

/** The sandboxed document preview. Where the screen is narrower than the paper it is shrunk to fit, so a phone shows the whole page and not its left edge. */
export default function PreviewFrame({ title, srcDoc, height = 980 }: { title: string; srcDoc: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / PAPER));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (scale >= 1) return <div ref={box}><iframe className="preview" style={{ height }} title={title} sandbox="" srcDoc={srcDoc} /></div>;
  return (
    <div ref={box} style={{ height: height * scale, overflow: 'hidden' }}>
      <iframe className="preview" style={{ width: PAPER, maxWidth: 'none', height, margin: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} title={title} sandbox="" srcDoc={srcDoc} />
    </div>
  );
}
