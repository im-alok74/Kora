'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';
import { TOOLS, TOOL_GROUPS, toolIcon } from '../lib/tools';

/**
 * The Tools menu in the header. A real button, so it opens with Enter, Space or a tap; it also opens when a mouse rests on it
 * (a mouse click then keeps it open instead of closing what the hover just opened).
 * Escape closes it and gives focus back to the button, and so does moving focus or clicking outside. The tools are grouped.
 */
export default function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div
      ref={root}
      className={`k-menu${open ? ' open' : ''}`}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { clearTimeout(timer.current); setOpen(true); } }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') timer.current = setTimeout(() => setOpen(false), 160); }}
      onBlur={(e) => { if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button ref={btn} type="button" className="k-menu-btn" aria-expanded={open} aria-controls={id} onClick={(e) => setOpen((o) => ((e.nativeEvent as PointerEvent).pointerType === 'mouse' ? true : !o))}>
        Tools <Icon name="arrow" size={13} />
      </button>
      <div className="k-menu-pop" id={id} hidden={!open}>
        {TOOL_GROUPS.map((g) => (
          <div key={g} className="k-menu-col" role="group" aria-label={g}>
            <span className="k-menu-h" aria-hidden="true">{g}</span>
            {TOOLS.filter((t) => t.group === g).map((t) => <a key={t.slug} href={`/tools/${t.slug}`}><span className="k-menu-ico"><Icon name={toolIcon(t.slug)} size={16} /></span>{t.title}</a>)}
          </div>
        ))}
        <a className="k-menu-all" href="/tools">See all {TOOLS.length} free tools <Icon name="arrow" size={13} /></a>
      </div>
    </div>
  );
}
