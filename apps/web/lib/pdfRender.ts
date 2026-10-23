import type { PDFDocumentProxy } from 'pdfjs-dist';
import { canvasToBlob, LIMITS } from './browserFiles';

/** pdf.js is large, so it is only fetched when someone opens a PDF in a tool that needs to draw pages. */
async function engine() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs;
}

export class PdfOpenError extends Error {
  constructor(public reason: 'password' | 'wrong-password' | 'broken', message: string) { super(message); }
}

/** Opens a PDF for drawing. Needs a password for protected files; says which of the three things went wrong. */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await engine();
  const task = pdfjs.getDocument({ data: bytes.slice(), password, enableXfa: false });
  try { return await task.promise; } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') {
      throw err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? new PdfOpenError('wrong-password', 'That password did not open the PDF. Check it and try again.')
        : new PdfOpenError('password', 'This PDF is password protected. Enter its password to continue.');
    }
    throw new PdfOpenError('broken', 'This file could not be read. It may be damaged or not a PDF.');
  }
}

/** The scale that gives `wanted`, lowered if the page would need more than the canvas limit. */
export function safeScale(widthPt: number, heightPt: number, wanted: number): { scale: number; reduced: boolean } {
  const px = widthPt * heightPt * wanted * wanted;
  if (px <= LIMITS.canvasPixels) return { scale: wanted, reduced: false };
  return { scale: Math.sqrt(LIMITS.canvasPixels / (widthPt * heightPt)), reduced: true };
}

/** Draws one page (1-based) and saves it as PNG or JPEG. Pages are drawn on white, as a printed page would be. */
export async function pageToBlob(doc: PDFDocumentProxy, n: number, o: { scale: number; type: 'image/png' | 'image/jpeg'; quality?: number }): Promise<{ blob: Blob; width: number; height: number; reduced: boolean }> {
  const page = await doc.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const { scale, reduced } = safeScale(base.width, base.height, o.scale);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d');
    if (!g) throw new Error('The browser could not prepare the page. Try a lower quality.');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
    const blob = await canvasToBlob(c, o.type, o.quality);
    const out = { blob, width: c.width, height: c.height, reduced };
    c.width = c.height = 0;
    return out;
  } finally { page.cleanup(); }
}
