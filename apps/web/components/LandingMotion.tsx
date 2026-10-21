'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Motion is progressive: content remains visible before hydration and without JS. */
export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (preference.matches) continue;
        const cards = Array.from(entry.target.querySelectorAll<HTMLElement>('.k-benefit'));
        const bounds = entry.target.getBoundingClientRect();
        for (const card of cards) {
          const box = card.getBoundingClientRect();
          const offset = window.innerWidth > 1024 ? bounds.left + bounds.width / 2 - box.left - box.width / 2 : 0;
          animations.push(card.animate([
            { opacity: 0, transform: `translate(${offset}px, 24px) scale(.6)` },
            { opacity: 1, transform: 'translate(0, 0) scale(1)' },
          ], { duration: 1200, easing: 'ease-out' }));
        }
      }
    }, { threshold: .15 });
    const benefits = page.querySelector('.k-benefits');
    if (benefits) observer.observe(benefits);
    const onPreference = () => { if (preference.matches) animations.forEach(animation => animation.cancel()); };
    preference.addEventListener('change', onPreference);
    return () => { observer.disconnect(); preference.removeEventListener('change', onPreference); animations.forEach(animation => animation.cancel()); };
  }, []);

  return <div ref={root} className="landing kora-home">{children}</div>;
}
