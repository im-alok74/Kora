import { degrees, EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { PdfProblem } from './pdfPages';

export { PdfProblem, parsePageGroups, parsePageList } from './pdfPages';

/** Opens a PDF for editing. Password-protected and damaged files get a plain explanation. */
export async function openForEdit(bytes: Uint8Array, name = 'This file'): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.getPageCount() === 0) throw new PdfProblem('empty', `${name} has no pages.`);
    return doc;
  } catch (e) {
    if (e instanceof PdfProblem) throw e;
    if (e instanceof EncryptedPDFError || /encrypted/i.test((e as Error)?.message ?? '')) throw new PdfProblem('encrypted', `${name} is password protected. Open it with its password and save an unprotected copy first, then add it here.`);
    throw new PdfProblem('broken', `${name} could not be read. It may be damaged or not a PDF.`);
  }
}

/** Page count without keeping the document. */
export async function pageCountOf(bytes: Uint8Array, name?: string): Promise<number> { return (await openForEdit(bytes, name)).getPageCount(); }

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
