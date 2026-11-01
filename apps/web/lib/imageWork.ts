import { fitToSize } from './sizeTarget';
import type { ImageFormat } from './browserFiles';

/**
 * Picture work for the logo tool: fit an existing logo under Kora's 150 KB limit. It runs on the page with a canvas;
 * the picture is decoded and saved in the browser and never uploaded.
 */
type Canvas = HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const toBlob = (c: Canvas, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not save the picture.'))), type, quality));

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
  const g = c.getContext('2d');
  if (!g) throw new Error('The browser could not prepare the picture. Try a smaller one.');
  if (o.type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(bm, 0, 0, w, h);
  const blob = await toBlob(c, o.type, o.quality);
  c.width = c.height = 0;
  if (blob.type !== o.type) throw new Error(`This browser cannot save ${EXT[o.type]} pictures. Choose another format.`);
  return blob;
}

/** The largest logo file Kora accepts for an invoice. */
export const LOGO_MAX_KB = 150;
export type FittedLogo = { blob: Blob; width: number; height: number; met: boolean; note: string };

/**
 * Fits a logo under Kora's size limit. PNG and JPG keep their type (a WebP logo becomes a JPG, which Kora accepts). We lower the
 * quality first, then the dimensions, until the file fits. A PNG can only get smaller by losing pixels, so when that costs more than
 * a tenth of the width a JPG is tried too and kept if it preserves more of the picture.
 */
export async function fitLogo(blob: Blob, name: string, o: { type: ImageFormat; maxPixels: number; kb?: number }, report: (m: string) => void = () => {}): Promise<FittedLogo> {
  const kb = o.kb ?? LOGO_MAX_KB;
  const bm = await decode(blob, name, o.maxPixels);
  try {
    let n = 0;
    const fit = (t: ImageFormat) => fitToSize(async (scale, q) => {
      if (++n === 1 || n % 4 === 0) report(`Making the logo smaller (try ${n})`);
      const b = await draw(bm, { type: t, quality: q ?? undefined, width: bm.width * scale, height: bm.height * scale });
      return { out: b, size: b.size };
    }, kb * 1024, { lossy: t !== 'image/png' });
    let r = await fit(o.type), jpgNote = '';
    if (o.type === 'image/png' && r.scale < 0.9) {
      const j = await fit('image/jpeg');
      if (j.met && j.scale > r.scale) { r = j as typeof r; jpgNote = ' Saved as JPG to keep more detail; transparent areas became white.'; }
    }
    let note = r.met
      ? `Fits under ${kb} KB${r.scale < 1 ? `, with the logo made ${Math.round((1 - r.scale) * 100)}% smaller in each direction` : ''}.${jpgNote}`
      : `Could not reach ${kb} KB without making the logo tiny. This is the smallest we could make. Try a simpler picture.`;
    if (r.met && r.out.size > blob.size) note += ' This is larger than your original, which was already under the limit. Keep the original.';
    return { blob: r.out, width: Math.round(bm.width * r.scale), height: Math.round(bm.height * r.scale), met: r.met, note };
  } finally { bm.close(); }
}
