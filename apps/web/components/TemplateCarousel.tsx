'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';

export default function TemplateCarousel({ children }: { children: ReactNode }) {
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
    if (paused || hovered || focused || !visible) animation.current?.pause();
    else animation.current?.play();
  }, [paused, hovered, focused, visible, canAnimate]);

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

  return <div className="k-template-carousel" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={event => {
    setFocused(true);
    if (event.target instanceof HTMLAnchorElement && animation.current) {
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
      <button type="button" aria-label="Previous templates" onClick={() => move(-1)}><Icon name="arrow" className="k-arrow-back" size={18} /></button>
      {canAnimate ? <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button> : null}
      <button type="button" aria-label="Next templates" onClick={() => move(1)}><Icon name="arrow" size={18} /></button>
    </div>
    <div className="k-template-viewport" ref={viewport}>
      <div className="k-template-track" ref={track}>
        <div className="l-tpl">{children}</div>
        {canAnimate ? <div className="l-tpl" aria-hidden="true" inert>{children}</div> : null}
      </div>
    </div>
  </div>;
}
