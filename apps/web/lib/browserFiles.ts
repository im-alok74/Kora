/** Limits for the logo picture. It is held in the browser's memory, so each is set well below what a phone can take. */
export const LIMITS = {
  imageBytes: 25 * 1024 * 1024,       // one picture
  imagePixels: 50_000_000,            // decoded size of one picture (50 megapixels)
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

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';
export const EXT: Record<ImageFormat, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const formatOf = (f: Blob & { name?: string }): ImageFormat => (f.type === 'image/png' || /\.png$/i.test(f.name ?? '') ? 'image/png' : f.type === 'image/webp' || /\.webp$/i.test(f.name ?? '') ? 'image/webp' : 'image/jpeg');

/** A plain check of a chosen picture before it is decoded. Returns a message, or '' when it is fine. */
export function pictureProblem(f: File): string {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) return `${f.name} is not a JPG, PNG or WebP picture.`;
  if (f.size === 0) return `${f.name} is empty.`;
  if (f.size > LIMITS.imageBytes) return `${f.name} is over 25 MB. Choose a smaller picture.`;
  return '';
}
