/**
 * Finds the best picture that fits a size limit. `encode(scale, quality)` returns the picture drawn at `scale` (1 = full size)
 * and saved at `quality` (0.05 to 1), with its size in bytes; quality is null for formats that do not use it, such as PNG.
 * Lossy formats: at each size we search for the highest quality that still fits. If even the lowest quality is too big we make
 * the picture smaller and try again. The last (smallest) try is returned with met = false if nothing fit.
 */
export type Fit<T> = { out: T; size: number; scale: number; quality: number | null; met: boolean; tries: number };

export async function fitToSize<T>(
  encode: (scale: number, quality: number | null) => Promise<{ out: T; size: number }>,
  target: number,
  o: { lossy: boolean; scales?: number[]; minQuality?: number; maxQuality?: number; steps?: number } = { lossy: true },
): Promise<Fit<T>> {
  const scales = o.scales ?? [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25];
  const lo0 = o.minQuality ?? 0.3, hi0 = o.maxQuality ?? 0.92, steps = o.steps ?? 6;
  let tries = 0;
  const one = async (s: number, q: number | null) => { tries++; return { ...(await encode(s, q)), scale: s, quality: q }; };
  let last: Awaited<ReturnType<typeof one>> | undefined;
  for (const scale of scales) {
    if (!o.lossy) {
      const r = await one(scale, null);
      last = r;
      if (r.size <= target) return { ...r, met: true, tries };
      continue;
    }
    const best = await one(scale, hi0);
    last = best;
    if (best.size <= target) return { ...best, met: true, tries };
    const worst = await one(scale, lo0);
    last = worst;
    if (worst.size > target) continue;
    let good = worst, lo = lo0, hi = hi0;
    for (let i = 0; i < steps; i++) {
      const mid = (lo + hi) / 2;
      const r = await one(scale, mid);
      if (r.size <= target) { good = r; lo = mid; } else hi = mid;
    }
    return { ...good, met: true, tries };
  }
  return { ...last!, met: false, tries };
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`);
