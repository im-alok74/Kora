import { fitToSize } from './sizeTarget';
import type { ImageFormat } from './browserFiles';

/**
 * Picture work that runs in a Web Worker (see toolWorker.ts) and, when the browser cannot do that, on the page itself.
 * It uses OffscreenCanvas, which exists in both places. A worker that has none says so, and the caller runs the task on the page.
 */
export class NeedsMainThread extends Error {}
type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') throw new NeedsMainThread('no OffscreenCanvas here');
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const toBlob = (c: Canvas, type: string, quality?: number): Promise<Blob> =>
  'convertToBlob' in c
    ? c.convertToBlob({ type, quality })
    : new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not save the picture.'))), type, quality));

const EXT: Record<ImageFormat, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };

async function decode(blob: Blob, name: string, maxPixels: number): Promise<ImageBitmap> {
  let bm: ImageBitmap;
  try { bm = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { throw new Error(`${name} could not be read. It may be damaged.`); }
  if (bm.width * bm.height > maxPixels) {
    const { width, height } = bm; bm.close();
    throw new Error(`${name} is ${width} x ${height} pixels, which is too large for the browser to handle safely. Shrink it first (the limit is ${Math.round(maxPixels / 1e6)} megapixels).`);
  }
  return bm;
}

/** Draws a picture at a size and saves it. JPEG has no transparency, so it is put on white first. A browser that cannot save WebP returns PNG, which we catch. */
async function draw(bm: ImageBitmap, o: { type: ImageFormat; quality?: number; width: number; height: number }): Promise<Blob> {
  const w = Math.max(1, Math.round(o.width)), h = Math.max(1, Math.round(o.height));
  const c = makeCanvas(w, h);
  const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!g) throw new Error('The browser could not prepare the picture. Try a smaller one.');
  if (o.type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(bm, 0, 0, w, h);
  const blob = await toBlob(c, o.type, o.quality);
  c.width = c.height = 0;
  if (blob.type !== o.type) throw new Error(`This browser cannot save ${EXT[o.type]} pictures. Choose another format.`);
  return blob;
}

export async function probeImage(blob: Blob, name: string, maxPixels: number): Promise<{ width: number; height: number }> {
  const bm = await decode(blob, name, maxPixels);
  const r = { width: bm.width, height: bm.height };
  bm.close();
  return r;
}

export async function convertImage(blob: Blob, name: string, o: { type: ImageFormat; quality?: number; maxPixels: number }): Promise<Blob> {
  const bm = await decode(blob, name, o.maxPixels);
  try { return await draw(bm, { type: o.type, quality: o.quality, width: bm.width, height: bm.height }); } finally { bm.close(); }
}

export type CompressOptions = { mode: 'size' | 'dimensions'; kb: number; type: ImageFormat; width: number; height: number; quality: number; logo?: boolean; maxPixels: number };
export type Compressed = { blob: Blob; width: number; height: number; met: boolean; note: string };

/** Shrinks a picture to a size in KB (searching quality, then dimensions) or to given dimensions. `report` gets short progress lines. */
export async function compressImage(blob: Blob, name: string, s: CompressOptions, report: (m: string) => void = () => {}): Promise<Compressed> {
  const bm = await decode(blob, name, s.maxPixels);
  try {
    if (s.mode === 'dimensions') {
      const out = await draw(bm, { type: s.type, quality: s.type === 'image/png' ? undefined : s.quality / 100, width: s.width, height: s.height });
      return { blob: out, width: s.width, height: s.height, met: true, note: out.size > blob.size ? 'The new picture is larger than the original. Lower the quality or the size.' : '' };
    }
    let n = 0;
    const fit = (t: ImageFormat) => fitToSize(async (scale, q) => {
      if (++n === 1 || n % 4 === 0) report(`Making the smaller picture (try ${n})`);
      const b = await draw(bm, { type: t, quality: q ?? undefined, width: bm.width * scale, height: bm.height * scale });
      return { out: b, size: b.size };
    }, s.kb * 1024, { lossy: t !== 'image/png' });
    let r = await fit(s.type), jpgNote = '';
    // A PNG can only get smaller by losing pixels. For the logo button, a JPG that keeps more of the picture is the better answer.
    if (s.logo && s.type === 'image/png' && r.scale < 0.9) {
      const j = await fit('image/jpeg');
      if (j.met && j.scale > r.scale) { r = j as typeof r; jpgNote = ' Saved as JPG to keep more detail; transparent areas became white.'; }
    }
    let note = r.met
      ? `Fits under ${s.kb} KB${r.scale < 1 ? `, with the picture made ${Math.round((1 - r.scale) * 100)}% smaller in each direction` : ''}.${jpgNote}`
      : `Could not reach ${s.kb} KB without making the picture tiny. This is the smallest we could make. Try JPG or WebP, or a higher limit.`;
    if (r.met && r.out.size > blob.size) note += ' This is larger than your original, which was already under the limit. Keep the original.';
    return { blob: r.out, width: Math.round(bm.width * r.scale), height: Math.round(bm.height * r.scale), met: r.met, note };
  } finally { bm.close(); }
}

/** A picture prepared for a PDF page: upright, no longer than `side` pixels on its long edge, saved as JPEG. */
export async function pictureForPdf(blob: Blob, name: string, o: { side: number; quality: number; maxPixels: number }): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bm = await decode(blob, name, o.maxPixels);
  try {
    const k = Math.min(1, o.side / Math.max(bm.width, bm.height));
    const width = Math.max(1, Math.round(bm.width * k)), height = Math.max(1, Math.round(bm.height * k));
    const out = await draw(bm, { type: 'image/jpeg', quality: o.quality, width, height });
    return { bytes: new Uint8Array(await out.arrayBuffer()), width, height };
  } finally { bm.close(); }
}
