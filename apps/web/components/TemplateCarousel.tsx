'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

type Template = { key: string; label: string; html: string };

export default function TemplateCarousel({ templates }: { templates: Template[] }) {
  const [background, setBackground] = useState<'light' | 'dark'>('light');
  const [preview, setPreview] = useState<Template | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 801px) and (prefers-reduced-motion: no-preference)');
    const update = () => setCanAnimate(media.matches);
    update();
    media.addEventListener('change', update);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    if (viewport.current) observer.observe(viewport.current);
    return () => { media.removeEventListener('change', update); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element || !canAnimate) return;
    const start = () => {
      const time = animation.current?.currentTime ?? 0;
      animation.current?.cancel();
      animation.current = element.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${element.scrollWidth / 2}px)` }], { duration: 35000, iterations: Infinity, easing: 'linear' });
      animation.current.pause();
      animation.current.currentTime = time;
    };
    start();
    // Card widths are fixed at this breakpoint; no resize-driven animation reset is needed.
    return () => { animation.current?.cancel(); animation.current = null; };
  }, [canAnimate]);

  useEffect(() => {
    if (paused || hovered || focused || preview || !visible) animation.current?.pause();
    else animation.current?.play();
  }, [paused, hovered, focused, visible, canAnimate, preview]);

  function move(direction: number) {
    setPaused(true);
    if (animation.current) {
      animation.current.pause();
      const time = Number(animation.current.currentTime ?? 0);
      animation.current.currentTime = (time + direction * 8750 + 35000) % 35000;
    } else {
      viewport.current?.scrollBy({ left: direction * 282, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }

  return <div className="k-template-carousel" data-background={background} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={event => {
    setFocused(true);
    if (event.target instanceof HTMLElement && event.target.classList.contains('tpl-card') && animation.current) {
      animation.current.pause();
      animation.current.currentTime = 0;
      event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      if (canAnimate && viewport.current) viewport.current.scrollLeft = 0;
      setFocused(false);
    }
  }}>
    <div className="k-template-controls" aria-label="Invoice template gallery">
      <div className="k-template-background" role="group" aria-label="Preview background">
        <span>Background</span>
        <button type="button" aria-pressed={background === 'light'} onClick={() => setBackground('light')}>Light</button>
        <button type="button" aria-pressed={background === 'dark'} onClick={() => setBackground('dark')}>Dark</button>
      </div>
      <button type="button" aria-label="Previous templates" onClick={() => move(-1)}><Icon name="arrow" className="k-arrow-back" size={18} /></button>
      {canAnimate ? <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button> : null}
      <button type="button" aria-label="Next templates" onClick={() => move(1)}><Icon name="arrow" size={18} /></button>
    </div>
    <div className="k-template-viewport" ref={viewport}>
      <div className="k-template-track" ref={track}>
        {[false, ...(canAnimate ? [true] : [])].map(duplicate => <div className="l-tpl" key={String(duplicate)} aria-hidden={duplicate || undefined}>
          {templates.map(template => <button type="button" key={template.key} className="tpl-card" tabIndex={duplicate ? -1 : 0} onClick={() => setPreview(template)} aria-label={`Preview ${template.label} invoice`}>
            <span className="tpl-thumb" aria-hidden="true"><iframe title={`${template.label} sample invoice`} srcDoc={template.html} sandbox="" tabIndex={-1} loading="lazy" /></span>
            <span className="tpl-foot"><span>{template.label}</span><Icon name="arrow" size={18} /></span>
          </button>)}
        </div>)}
      </div>
    </div>
    <p className="k-template-caption">Actual Kora invoice layouts with fictional sample details. Select a template to read it in full.</p>
    <dialog className="k-invoice-dialog" ref={dialog} onClose={() => setPreview(null)} aria-label={`${preview?.label ?? ''} invoice preview`}>
      <header><strong>{preview?.label} invoice</strong><button type="button" autoFocus onClick={() => dialog.current?.close()}>Close preview</button></header>
      {preview && <iframe title={`${preview.label} invoice preview`} sandbox="" srcDoc={preview.html} />}
      <footer>Sample invoice · No payment due <a href="/login?signup=1">Create your own invoice <Icon name="arrow" size={16} /></a></footer>
    </dialog>
  </div>;
}
