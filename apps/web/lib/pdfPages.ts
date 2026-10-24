// Page lists and the error type the PDF tools share. No pdf-lib here, so the page itself can use it without loading the PDF engine.
/** Friendly failure for a file that cannot be used. `reason` lets the page choose its own wording. */
export class PdfProblem extends Error {
  constructor(public reason: 'encrypted' | 'broken' | 'empty' | 'range', message: string) { super(message); }
}

/**
 * "1-3, 5, 8-" with 10 pages -> [0,1,2,4,7,8,9]. Order is kept as typed and repeats are allowed, so "3,1" reorders.
 * Page numbers start at 1; "8-" runs to the last page; "-3" runs from the first.
 */
export function parsePageList(spec: string, pageCount: number): number[] {
  const out: number[] = [];
  for (const part of splitParts(spec)) out.push(...rangeOf(part, pageCount));
  if (!out.length) throw new PdfProblem('range', 'Enter the pages you want, like 1-3, 5, 8-10.');
  return out;
}

/** "1-3, 5, 8-" -> [[0,1,2],[4],[7,8,9]]: one group per comma part, for splitting into several files. */
export function parsePageGroups(spec: string, pageCount: number): number[][] {
  const groups = splitParts(spec).map((p) => rangeOf(p, pageCount));
  if (!groups.length) throw new PdfProblem('range', 'Enter the pages you want, like 1-3, 5, 8-10.');
  return groups;
}

const splitParts = (spec: string) => spec.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);

function rangeOf(part: string, n: number): number[] {
  const m = /^(\d*)\s*(-|to)?\s*(\d*)$/i.exec(part);
  if (!m || (!m[1] && !m[3])) throw new PdfProblem('range', `"${part}" is not a page or a range. Use numbers like 4 or 2-6.`);
  const a = m[2] ? (m[1] ? Number(m[1]) : 1) : Number(m[1] || m[3]);
  const b = m[2] ? (m[3] ? Number(m[3]) : n) : a;
  if (a < 1 || b < 1) throw new PdfProblem('range', 'Page numbers start at 1.');
  if (a > n || b > n) throw new PdfProblem('range', `This PDF has ${n} page${n === 1 ? '' : 's'}. "${part}" goes past the end.`);
  if (b < a) throw new PdfProblem('range', `"${part}" runs backwards. Write it as ${b}-${a}.`);
  return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
}

