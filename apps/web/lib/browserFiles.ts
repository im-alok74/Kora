import { zip } from 'fflate';

/** Limits for the file tools. Everything is held in the browser's memory, so each is set well below what a phone can take. */
export const LIMITS = {
  imageBytes: 25 * 1024 * 1024,       // one picture
  imageFiles: 30,                     // pictures in one batch
  imagePixels: 50_000_000,            // decoded size of one picture (50 megapixels)
  pdfBytes: 100 * 1024 * 1024,        // one PDF
  pdfFiles: 20,                       // PDFs to merge
  totalBytes: 300 * 1024 * 1024,      // everything added to one tool
  pdfPages: 100,                      // pages turned into pictures in one go
  canvasPixels: 16_000_000,           // one rendered PDF page (about 4000 x 4000)
};

export const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export const baseName = (n: string) => n.replace(/\.[^./\\]+$/, '') || 'file';

/** Download a Blob. The address is released a little later, once the browser has started the save. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const readBytes = async (f: Blob) => new Uint8Array(await f.arrayBuffer());

/** Keeps file names in a ZIP or a batch from clashing: a.png, a (2).png, a (3).png. */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) { const n = `${stem} (${i})${ext}`; if (!used.has(n)) { used.add(n); return n; } }
}

/** Packs files into a ZIP in a background worker, so the page stays responsive. Pictures and PDFs are already compressed, so they are stored. */
export function makeZip(files: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const input: Record<string, [Uint8Array, { level: 0 }]> = {};
  const used = new Set<string>();
  for (const f of files) input[uniqueName(f.name, used)] = [f.data, { level: 0 }];
  return new Promise((resolve, reject) => zip(input, (err, data) => (err ? reject(err) : resolve(new Blob([data as BlobPart], { type: 'application/zip' })))));
}

export const canvasToBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not save the picture.'))), type, quality));

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';
export const EXT: Record<ImageFormat, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** A plain check of a chosen picture before it is decoded. Returns a message, or '' when it is fine. */
export function pictureProblem(f: File): string {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) return `${f.name} is not a JPG, PNG or WebP picture.`;
  if (f.size === 0) return `${f.name} is empty.`;
  if (f.size > LIMITS.imageBytes) return `${f.name} is over 25 MB. Choose a smaller picture.`;
  return '';
}
