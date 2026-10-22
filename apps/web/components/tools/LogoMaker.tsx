'use client';
import { useEffect, useRef, useState } from 'react';

const COLOURS = ['#106cd9', '#0b7d3e', '#c43a2f', '#6a3fb5', '#b45309', '#1f2937'];
const SHAPES: [string, string][] = [['circle', 'Circle'], ['rounded', 'Rounded square'], ['square', 'Square'], ['none', 'No shape']];
const FONTS: [string, string][] = [['Arial, Helvetica, sans-serif', 'Clean'], ['Georgia, serif', 'Classic'], ['"Trebuchet MS", sans-serif', 'Friendly'], ['"Courier New", monospace', 'Typewriter']];
type Layout = 'side' | 'stack' | 'mark';
type Look = { colour: string; shape: string; font: string; layout: Layout };

/** Ready starting points, shown as a gallery. Picking one sets the colour, shape, letters and layout together. */
const STYLES: Look[] = [
  { colour: COLOURS[0]!, shape: 'rounded', font: FONTS[0]![0], layout: 'side' },
  { colour: COLOURS[1]!, shape: 'circle', font: FONTS[2]![0], layout: 'stack' },
  { colour: COLOURS[2]!, shape: 'square', font: FONTS[1]![0], layout: 'side' },
  { colour: COLOURS[3]!, shape: 'rounded', font: FONTS[2]![0], layout: 'stack' },
  { colour: COLOURS[4]!, shape: 'circle', font: FONTS[1]![0], layout: 'side' },
  { colour: COLOURS[5]!, shape: 'none', font: FONTS[0]![0], layout: 'stack' },
  { colour: COLOURS[0]!, shape: 'circle', font: FONTS[3]![0], layout: 'mark' },
  { colour: COLOURS[1]!, shape: 'square', font: FONTS[0]![0], layout: 'side' },
];

function draw(c: HTMLCanvasElement, name: string, initials: string, look: Look, size = 1) {
  const g = c.getContext('2d')!;
  const W = 900, H = look.layout === 'stack' ? 700 : 400;
  c.width = W * size; c.height = H * size; g.setTransform(size, 0, 0, size, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const s = 240, mx = look.layout === 'side' ? 60 : (W - s) / 2, my = look.layout === 'stack' ? 60 : (H - s) / 2;
  g.fillStyle = look.colour;
  if (look.shape === 'circle') { g.beginPath(); g.arc(mx + s / 2, my + s / 2, s / 2, 0, Math.PI * 2); g.fill(); }
  else if (look.shape === 'rounded') { g.beginPath(); g.roundRect(mx, my, s, s, 56); g.fill(); }
  else if (look.shape === 'square') g.fillRect(mx, my, s, s);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = look.shape === 'none' ? look.colour : '#fff'; g.font = `700 ${look.shape === 'none' ? 150 : 110}px ${look.font}`;
  g.fillText(initials.slice(0, 3).toUpperCase(), mx + s / 2, my + s / 2 + 6);
  if (look.layout !== 'mark') {
    g.fillStyle = '#171b20'; g.font = `700 64px ${look.font}`;
    if (look.layout === 'side') { g.textAlign = 'left'; g.fillText(name, mx + s + 40, H / 2, W - mx - s - 80); } else { g.textAlign = 'center'; g.fillText(name, W / 2, my + s + 100, W - 80); }
  }
}

const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** A simple logo: initials in a shape, with the name beside them. Drawn on a canvas on your device. */
export default function LogoMaker() {
  const [name, setName] = useState('Sharma Traders');
  const [initials, setInitials] = useState('ST');
  const [look, setLook] = useState<Look>(STYLES[0]!);
  const canvas = useRef<HTMLCanvasElement>(null);
  const thumbs = useRef<(HTMLCanvasElement | null)[]>([]);
  const set = (p: Partial<Look>) => setLook({ ...look, ...p });

  useEffect(() => { draw(canvas.current!, name, initials, look); }, [name, initials, look]);
  useEffect(() => { STYLES.forEach((st, i) => { const c = thumbs.current[i]; if (c) draw(c, name || 'Your business', initials, st, 0.3); }); }, [name, initials]);

  return (
    <div className="tl-logo">
      <div className="tl-namebar no-print">
        <label htmlFor="ln">Business name</label>
        <input id="ln" value={name} maxLength={40} placeholder="Enter business name" onChange={(e) => { setName(e.target.value); setInitials(initialsOf(e.target.value)); }} />
      </div>
      <div className="tl-styles" role="group" aria-label="Starting styles">
        {STYLES.map((st, i) => (
          <button key={i} type="button" className="tl-style" aria-label={`Style ${i + 1}`} aria-pressed={JSON.stringify(st) === JSON.stringify(look)} onClick={() => setLook(st)}>
            <canvas ref={(el) => { thumbs.current[i] = el; }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="tl-calc">
        <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="li">Letters in the mark (up to 3)</label><input id="li" value={initials} maxLength={3} onChange={(e) => setInitials(e.target.value)} />
          <fieldset className="tl-fs"><legend>Colour</legend><div className="tl-chips" role="radiogroup" aria-label="Colour">
            {COLOURS.map((c) => <button key={c} type="button" role="radio" aria-checked={look.colour === c} aria-label={c} className="tl-swatch" style={{ background: c, outlineColor: look.colour === c ? 'var(--text)' : 'transparent' }} onClick={() => set({ colour: c })} />)}
          </div></fieldset>
          <label htmlFor="ls">Shape</label><select id="ls" value={look.shape} onChange={(e) => set({ shape: e.target.value })}>{SHAPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label htmlFor="lf">Letter style</label><select id="lf" value={look.font} onChange={(e) => set({ font: e.target.value })}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label htmlFor="ll">Layout</label><select id="ll" value={look.layout} onChange={(e) => set({ layout: e.target.value as Layout })}><option value="side">Mark and name side by side</option><option value="stack">Name under the mark</option><option value="mark">Mark only</option></select>
        </form>
        <div className="tl-result">
          <canvas ref={canvas} className="tl-img" role="img" aria-label={`Logo preview for ${name}`} style={{ maxWidth: '100%', height: 'auto' }} />
          <div className="tl-actions"><button type="button" onClick={() => { const a = document.createElement('a'); a.href = canvas.current!.toDataURL('image/png'); a.download = 'logo.png'; a.click(); }}>Download PNG</button></div>
          <p className="muted">A simple starter logo. You can use it as your invoice logo in Kora (PNG under 150 KB works best at a smaller size).</p>
        </div>
      </div>
    </div>
  );
}
