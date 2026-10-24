import { compressImage, convertImage, pictureForPdf, probeImage } from './imageWork';
import { extractPages, imagesToPdf, mergePdfs, pageCountOf, rotatePages } from './pdfOps';

/**
 * Everything the file tools do that can take a while. The same table runs inside the worker (toolWorker.ts) and, as a fallback,
 * on the page (runTask.ts), so a browser without workers still works. Each task gets a `report` function for progress lines.
 */
export const TASKS = {
  probeImage: (_r: Report, ...a: Parameters<typeof probeImage>) => probeImage(...a),
  convertImage: (_r: Report, ...a: Parameters<typeof convertImage>) => convertImage(...a),
  compressImage: (r: Report, blob: Blob, name: string, s: Parameters<typeof compressImage>[2]) => compressImage(blob, name, s, r),
  pictureForPdf: (_r: Report, ...a: Parameters<typeof pictureForPdf>) => pictureForPdf(...a),
  mergePdfs: (_r: Report, ...a: Parameters<typeof mergePdfs>) => mergePdfs(...a),
  extractPages: (_r: Report, ...a: Parameters<typeof extractPages>) => extractPages(...a),
  rotatePages: (_r: Report, ...a: Parameters<typeof rotatePages>) => rotatePages(...a),
  pageCountOf: (_r: Report, ...a: Parameters<typeof pageCountOf>) => pageCountOf(...a),
  imagesToPdf: (_r: Report, ...a: Parameters<typeof imagesToPdf>) => imagesToPdf(...a),
};
export type Report = (message: string) => void;
export type TaskName = keyof typeof TASKS;
type Args<K extends TaskName> = Parameters<(typeof TASKS)[K]> extends [Report, ...infer A] ? A : never;
export type TaskArgs<K extends TaskName> = Args<K>;
export type TaskResult<K extends TaskName> = Awaited<ReturnType<(typeof TASKS)[K]>>;
