import type { SVGProps } from 'react';

/** Kora's own small icon set: simple outlines on a 24 grid. Decorative by default; give a title where an icon stands alone. */
const PATHS = {
  home: 'M3.5 11.2 12 4l8.5 7.2M6 9.8V20h12V9.8M10 20v-5.5h4V20',
  documents: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4M9.5 12h5M9.5 15.5h5',
  repeat: 'M17 4l3 3-3 3M20 7H9a5 5 0 0 0-5 5M7 20l-3-3 3-3M4 17h11a5 5 0 0 0 5-5',
  user: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c0-3.6 3.1-6 7-6s7 2.4 7 6',
  box: 'M12 3l8 4.2v9.6L12 21l-8-4.2V7.2zM4.2 7.4 12 11.5l7.8-4.1M12 11.5V21',
  receipt: 'M6 3.5h12V21l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12h6',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  database: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v11C4 18.9 7.6 20 12 20s8-1.1 8-2.5v-11M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 5l-3 14',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.6 2.6 0 1 0 0-5.2M17.5 14.2c2 .5 3.5 2.2 3.5 4.8',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.2 2',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  plus: 'M12 5v14M5 12h14',
  inbox: 'M4 13.5 6.5 5h11l2.5 8.5V19H4zM4 13.5h4.5l1 2h5l1-2H20',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  logout: 'M10 4.5H5.5v15H10M14 8l4 4-4 4M18 12H9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chat: 'M4 5.5h16v10H12l-4.5 3.5V15.5H4z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2v2',
  shield: 'M12 3l7.5 2.8v5.7c0 4.6-3.2 7.7-7.5 9.5-4.3-1.8-7.5-4.9-7.5-9.5V5.8zM9 12l2.2 2.2 4.3-4.4',
  phone: 'M7 3.5h10v17H7zM11 17.5h2',
  lock: 'M7 11h10v9H7zM9 11V8a3 3 0 0 1 6 0v3',
  invoice: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4M9.5 14l1.8 1.8 3.2-3.6',
  rupee: 'M7 5h10M7 9h10M7 5c5 0 7 1.6 7 4s-2 4-7 4l7 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 20, title, ...rest }: { name: IconName; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
