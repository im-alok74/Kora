/**
 * Small tools the list pages share: exporting what is on screen to a spreadsheet-safe CSV, and saving a list's filters and
 * columns as a named view on this device. Views live in this browser only; storage can be blocked, so every access is guarded.
 */

type Cell = string | number | bigint | null | undefined;

/**
 * CSV for a file people open in a spreadsheet. Quotes and line breaks are escaped, and a cell that starts with = + - @ or a tab
 * is prefixed with a quote so a name like "=HYPERLINK(...)" cannot run as a formula. A BOM makes Excel read UTF-8 names correctly.
 */
export function csvText(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Paise as plain rupees for a spreadsheet: 118000 becomes 1180.00, so Excel can add it up. */
export const rupeesPlain = (p: string | bigint) => {
  const n = BigInt(p); const neg = n < 0n; const a = neg ? -n : n;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- saved views
export interface SavedView<S> { name: string; state: S }

const key = (list: string) => `kora.views.${list}`;

export function loadViews<S>(list: string): SavedView<S>[] {
  try {
    const raw = window.localStorage.getItem(key(list));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string' && x.state && typeof x.state === 'object').slice(0, 20) : [];
  } catch { return []; }
}

function store<S>(list: string, views: SavedView<S>[]): boolean {
  try { window.localStorage.setItem(key(list), JSON.stringify(views)); return true; } catch { return false; }
}

/** Saves under a name, replacing a view of the same name. Returns the new list, or null when this browser will not store it. */
export function saveView<S>(list: string, name: string, state: S): SavedView<S>[] | null {
  const n = name.trim().slice(0, 40);
  if (!n) return null;
  const next = [...loadViews<S>(list).filter((v) => v.name.toLowerCase() !== n.toLowerCase()), { name: n, state }].slice(-20);
  return store(list, next) ? next : null;
}

export function deleteView<S>(list: string, name: string): SavedView<S>[] {
  const next = loadViews<S>(list).filter((v) => v.name !== name);
  store(list, next);
  return next;
}
