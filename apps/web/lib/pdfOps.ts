import { degrees, EncryptedPDFError, PDFDocument } from 'pdf-lib';

/** Friendly failure for a file that cannot be used. `reason` lets the page choose its own wording. */
export class PdfProblem extends Error {
  constructor(public reason: 'encrypted' | 'broken' | 'empty' | 'range', message: string) { super(message); }
}

/** Opens a PDF for editing. Password-protected and damaged files get a plain explanation. */
export async function openForEdit(bytes: Uint8Array, name = 'This file'): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.getPageCount() === 0) throw new PdfProblem('empty', `${name} has no pages.`);
    return doc;
  } catch (e) {
    if (e instanceof PdfProblem) throw e;
    if (e instanceof EncryptedPDFError) throw new PdfProblem('encrypted', `${name} is password protected. Open it with its password and save an unprotected copy first, then add it here.`);
    throw new PdfProblem('broken', `${name} could not be read. It may be damaged or not a PDF.`);
  }
}

/** Page count without keeping the document. */
export async function pageCountOf(bytes: Uint8Array, name?: string): Promise<number> { return (await openForEdit(bytes, name)).getPageCount(); }

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

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

/** Joins PDFs in the order given. */
export async function mergePdfs(files: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  if (!files.length) throw new PdfProblem('empty', 'Add at least one PDF.');
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await openForEdit(f.bytes, f.name);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return save(out);
}

/** A new PDF with only the given pages (0-based), in that order. */
export async function extractPages(bytes: Uint8Array, pages: number[], name?: string): Promise<Uint8Array> {
  const src = await openForEdit(bytes, name);
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, pages)) out.addPage(p);
  return save(out);
}

/** Turns the given pages (0-based) clockwise by 90, 180 or 270 degrees, on top of any turn they already have. */
export async function rotatePages(bytes: Uint8Array, pages: number[], angle: 90 | 180 | 270, name?: string): Promise<Uint8Array> {
  const doc = await openForEdit(bytes, name);
  const all = doc.getPages();
  for (const i of pages) {
    const p = all[i]!;
    p.setRotation(degrees((p.getRotation().angle + angle) % 360));
  }
  return save(doc);
}

export const A4 = { w: 595.28, h: 841.89 };
export type PageSize = 'a4' | 'a4-portrait' | 'a4-landscape' | 'fit';
export type PageImage = { bytes: Uint8Array; type: 'jpg' | 'png'; width: number; height: number };

/**
 * One image per page. `a4` picks portrait or landscape to suit each picture. `fit` makes each page the size of its
 * picture (plus margin). The picture is never stretched: it is scaled to fit inside the margins and centred.
 * Margin is in points (72 = one inch).
 */
export async function imagesToPdf(images: PageImage[], o: { size: PageSize; margin: number }): Promise<Uint8Array> {
  if (!images.length) throw new PdfProblem('empty', 'Add at least one picture.');
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === 'jpg' ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
    let pw: number, ph: number;
    if (o.size === 'fit') { pw = im.width + 2 * o.margin; ph = im.height + 2 * o.margin; }
    else {
      const landscape = o.size === 'a4-landscape' || (o.size === 'a4' && im.width > im.height);
      pw = landscape ? A4.h : A4.w; ph = landscape ? A4.w : A4.h;
    }
    const k = Math.min((pw - 2 * o.margin) / im.width, (ph - 2 * o.margin) / im.height, o.size === 'fit' ? 1 : Infinity);
    const w = im.width * k, h = im.height * k;
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return save(doc);
}
