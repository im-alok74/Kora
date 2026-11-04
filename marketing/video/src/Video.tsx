// A 28-second 9:16 reel built from real screenshots of the app (marketing/capture-screens.mjs), animated: hook, invoice, GST,
// WhatsApp, UPI, end card. No music: the trending track is added in Instagram/YouTube, which is how reels get reach.
import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const C = { ink: '#0f1113', teal: '#087f78', mint: '#24b79d', amber: '#ffc247', paper: '#f4f6f7', wa: '#d9fdd3' };
const FONT = "'Segoe UI', Inter, system-ui, sans-serif";

/** Scene boundaries, in frames at 30 fps. */
const S = { hook: [0, 80], brand: [80, 125], editor: [125, 275], gst: [275, 425], wa: [425, 590], upi: [590, 740], end: [740, 860] } as const;
export const TOTAL = S.end[1];

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const useIn = (delay = 0, damping = 14) => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return spring({ frame: f - delay, fps, config: { damping, mass: 0.7 } }); };

/** Words that rise in one after another. Words wrapped in * are highlighted. */
const Kinetic: React.FC<{ text: string; size: number; color?: string; hl?: string; delay?: number; align?: 'left' | 'center' }> = ({ text, size, color = '#fff', hl = C.amber, delay = 0, align = 'left' }) => {
  const f = useCurrentFrame();
  return <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.05, letterSpacing: '-0.03em', color, textAlign: align, display: 'flex', flexWrap: 'wrap', gap: `0 ${size * 0.25}px`, justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
    {text.split(' ').map((w, i) => {
      const t = interpolate(f - delay - i * 4, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
      const star = w.startsWith('*');
      return <span key={i} style={{ display: 'inline-block', opacity: t, transform: `translateY(${(1 - t) * size * 0.6}px)`, color: star ? hl : color }}>{w.replace(/\*/g, '')}</span>;
    })}
  </div>;
};

/** A phone with a screenshot inside. zoom/focusY move a camera over the screenshot (focusY 0..1 of the image height). */
const Phone: React.FC<{ src: string; aspect: number; zoom?: number; focusY?: number; children?: React.ReactNode }> = ({ src, aspect, zoom = 1, focusY = 0, children }) => {
  const W = 760, H = 1560, inner = W - 36;
  const imgH = inner / aspect;
  const visible = (H - 36) / zoom;
  const y = Math.max(0, Math.min(imgH - visible, focusY * imgH - visible / 2));
  return <div style={{ width: W, height: H, borderRadius: 86, background: '#111', padding: 18, boxShadow: '0 60px 120px rgba(0,0,0,.45), inset 0 0 0 3px #2a2c30', position: 'relative' }}>
    <div style={{ width: '100%', height: '100%', borderRadius: 70, overflow: 'hidden', background: '#fff', position: 'relative' }}>
      <Img src={staticFile(src)} style={{ width: inner * zoom, position: 'absolute', left: -((inner * zoom - inner) / 2), top: -y * zoom }} />
      {children}
    </div>
  </div>;
};

/** A region of a screenshot (in source pixels), enlarged to `width`: the pop-out that makes small UI readable on a phone feed. */
const Crop: React.FC<{ src: string; sw: number; x: number; y: number; w: number; h: number; width: number; children?: React.ReactNode }> = ({ src, sw, x, y, w, h, width, children }) => {
  const k = width / w;
  return <div style={{ width, height: h * k, overflow: 'hidden', borderRadius: 34, position: 'relative', background: '#fff', boxShadow: '0 40px 90px rgba(0,0,0,.35)', outline: `6px solid ${C.amber}` }}>
    <Img src={staticFile(src)} style={{ position: 'absolute', width: sw * k, left: -x * k, top: -y * k }} />
    {children}
  </div>;
};

const Pop: React.FC<{ at: number; top: number; children: React.ReactNode }> = ({ at, top, children }) => {
  const t = useIn(at, 12);
  return <div style={{ position: 'absolute', left: 60, right: 60, top, display: 'flex', justifyContent: 'center', opacity: Math.min(1, t * 1.5), transform: `scale(${0.6 + t * 0.4}) translateY(${(1 - t) * 120}px)` }}>{children}</div>;
};

const Caption: React.FC<{ text: string; step?: string }> = ({ text, step }) => (
  <div style={{ position: 'absolute', top: 120, left: 80, right: 80 }}>
    {step && <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 34, color: C.mint, letterSpacing: '.12em', marginBottom: 14 }}>{step}</div>}
    <Kinetic text={text} size={92} color={C.ink} hl={C.teal} />
  </div>
);

const PhoneStage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const t = useIn(0, 16);
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
    <div style={{ transform: `translateY(${(1 - t) * 900 + 40}px) scale(.8)`, transformOrigin: 'bottom center' }}>{children}</div>
  </AbsoluteFill>;
};

const Due: React.FC<{ i: number; name: string; amt: string; days: number }> = ({ i, name, amt, days }) => {
  const t = useIn(30 + i * 7, 13);
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1c1f23', border: '2px solid #2c3036', borderRadius: 26, padding: '26px 34px', fontFamily: FONT, transform: `translateX(${(1 - t) * -1100}px)` }}>
    <div><div style={{ color: '#fff', fontSize: 40, fontWeight: 700 }}>{name}</div><div style={{ color: '#ff8f86', fontSize: 30, marginTop: 4 }}>{days} din se pending</div></div>
    <div style={{ color: '#fff', fontSize: 50, fontWeight: 900 }}>Rs {amt}</div>
  </div>;
};

const Hook = () => {
  const f = useCurrentFrame();
  const shake = f > 34 && f < 50 ? Math.sin(f * 2.2) * 10 : 0;
  return <AbsoluteFill style={{ background: C.ink, padding: 90, justifyContent: 'center' }}>
    <div style={{ transform: `translateX(${shake}px)` }}><Kinetic text="Payment *kab aayega?" size={160} /></div>
    <div style={{ height: 50 }} />
    <Kinetic text="Bill bheja. Phir reminder. Phir intezaar." size={58} color="#c9ccd1" delay={26} />
    <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {[['Verma Stores', '11,800', 45], ['Gupta Electricals', '24,780', 32], ['Mehta & Sons', '8,260', 21]].map(([n, amt, d], i) => <Due key={i} i={i} name={n as string} amt={amt as string} days={d as number} />)}
    </div>
  </AbsoluteFill>;
};

const Brand = () => {
  const t = useIn(0, 12);
  return <AbsoluteFill style={{ background: C.teal, alignItems: 'center', justifyContent: 'center', gap: 40 }}>
    <svg viewBox="0 0 198 64" width={560} style={{ transform: `scale(${0.7 + t * 0.3})`, opacity: t, color: '#fff' }}>
      <path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="#fff" />
      <path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4" />
      <path d="M17 27H36M17 35H29M17 43H24" fill="none" stroke={C.teal} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="47" cy="51" r="10" fill={C.amber} />
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M78 13V49M97 26L79 38M84 35L99 49" /><circle cx="118" cy="37" r="12" /><path d="M141 49V26M141 36Q143 24 154 26" /><path d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37" />
      </g>
    </svg>
    <Kinetic text="Bill se *payment tak. Ek app." size={64} align="center" delay={8} />
  </AbsoluteFill>;
};

const Editor = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Caption step="STEP 1" text="Bill banao. *30 second." />
    <PhoneStage><Phone src="shots/editor-items.png" aspect={1170 / 2532} /></PhoneStage>
  </AbsoluteFill>
);

const Gst = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Caption step="STEP 2" text="GST *khud lagta hai." />
    <PhoneStage><Phone src="shots/editor-summary.png" aspect={1170 / 2532} /></PhoneStage>
    <Pop at={35} top={760}><Crop src="shots/editor-summary.png" sw={1170} x={90} y={1390} w={995} h={420} width={960} /></Pop>
  </AbsoluteFill>
);

const WhatsApp = () => {
  const b = useIn(45, 13);
  const tick = interpolate(useCurrentFrame(), [95, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: C.paper }}>
    <Caption step="STEP 3" text="Seedha *WhatsApp pe." />
    <PhoneStage><Phone src="shots/sent.png" aspect={1170 / 2532} zoom={1} focusY={0} /></PhoneStage>
    <div style={{ position: 'absolute', left: 120, right: 70, top: 1580, transform: `translateX(${(1 - b) * 900}px) rotate(${(1 - b) * 6}deg)`, background: C.wa, borderRadius: '34px 34px 6px 34px', padding: '30px 34px 22px', boxShadow: '0 30px 60px rgba(0,0,0,.25)', fontFamily: FONT }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#128c7e', marginBottom: 8 }}>WhatsApp · Sharma Traders</div>
      <div style={{ fontSize: 38, lineHeight: 1.3, color: '#111' }}>Tax invoice INV/26-27/0001 for Rs 11,800.00 from Sharma Traders. View and download: <span style={{ color: '#0a66c2' }}>link</span></div>
      <div style={{ textAlign: 'right', fontSize: 28, color: '#53bdeb', marginTop: 8, opacity: tick }}>✓✓</div>
    </div>
  </AbsoluteFill>;
};

const Upi = () => {
  const f = useCurrentFrame();
  const scan = interpolate((f - 40) % 45, [0, 45], [0, 1]);
  return <AbsoluteFill style={{ background: C.paper }}>
    <Caption step="STEP 4" text="Customer *scan kare. UPI se pay." />
    <PhoneStage><Phone src="shots/customer-invoice.png" aspect={1170 / 2892} focusY={0.35} /></PhoneStage>
    <Pop at={30} top={820}>
      <Crop src="shots/customer-invoice.png" sw={1170} x={70} y={1760} w={830} h={300} width={960}>
        <div style={{ position: 'absolute', left: 30, width: 290, top: 20 + scan * 300, height: 7, background: C.mint, boxShadow: `0 0 26px ${C.mint}`, opacity: f > 40 ? 1 : 0 }} />
      </Crop>
    </Pop>
  </AbsoluteFill>;
};

const End = () => {
  const t = useIn(18, 11);
  return <AbsoluteFill style={{ background: C.ink, padding: 90, justifyContent: 'center' }}>
    <svg viewBox="0 0 198 64" width={380} style={{ color: '#fff', marginBottom: 90 }}>
      <path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="#fff" />
      <path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4" />
      <path d="M17 27H36M17 35H29M17 43H24" fill="none" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="47" cy="51" r="10" fill={C.amber} />
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M78 13V49M97 26L79 38M84 35L99 49" /><circle cx="118" cy="37" r="12" /><path d="M141 49V26M141 36Q143 24 154 26" /><path d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37" />
      </g>
    </svg>
    <Kinetic text="Bill. GST. WhatsApp. *UPI." size={110} />
    <div style={{ height: 40 }} />
    <Kinetic text="Aapke CA ke saath, ek hi jagah." size={56} color="#c9ccd1" delay={14} />
    <div style={{ marginTop: 80, alignSelf: 'flex-start', transform: `scale(${t})`, background: C.amber, color: C.ink, fontFamily: FONT, fontWeight: 900, fontSize: 60, padding: '30px 54px', borderRadius: 30 }}>Free mein shuru karein</div>
    <div style={{ marginTop: 34, fontFamily: FONT, fontSize: 40, color: '#c9ccd1', opacity: t }}>Link in bio · Kora</div>
  </AbsoluteFill>;
};

const seq = (k: keyof typeof S, el: React.ReactNode) => <Sequence from={S[k][0]} durationInFrames={S[k][1] - S[k][0]}>{el}</Sequence>;

export const KoraInvoice = () => <AbsoluteFill style={{ background: C.ink }}>
  {seq('hook', <Hook />)}{seq('brand', <Brand />)}{seq('editor', <Editor />)}{seq('gst', <Gst />)}
  {seq('wa', <WhatsApp />)}{seq('upi', <Upi />)}{seq('end', <End />)}
</AbsoluteFill>;
