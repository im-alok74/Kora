// Code 128 (subsets B and C), the usual barcode for item codes. Returns the bars as module widths.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104, START_C = 105, SWITCH_C = 99, SWITCH_B = 100;

/** Printable ASCII only (space to ~). A run of 4 or more digits is packed in subset C, which makes the barcode shorter. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Enter something to encode.');
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('Use letters, numbers and common symbols only.');
  const out: number[] = [];
  let i = 0, mode: 'B' | 'C' | null = null;
  while (i < text.length) {
    const digits = /^\d+/.exec(text.slice(i))?.[0].length ?? 0;
    const useC = digits >= 4 || (mode === 'C' && digits >= 2);
    if (useC) {
      const n = digits - (digits % 2);
      if (mode === null) out.push(START_C); else if (mode !== 'C') out.push(SWITCH_C);
      mode = 'C';
      for (let k = 0; k < n; k += 2) out.push(Number(text.slice(i + k, i + k + 2)));
      i += n;
    } else {
      if (mode === null) out.push(START_B); else if (mode !== 'B') out.push(SWITCH_B);
      mode = 'B';
      out.push(text.charCodeAt(i) - 32);
      i++;
    }
  }
  const sum = out.reduce((s, v, idx) => s + v * (idx === 0 ? 1 : idx), 0);
  out.push(sum % 103, 106);
  return out;
}

/** Alternating bar and space widths, starting with a bar. */
export function code128Modules(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** An SVG of the barcode, with the text under it. */
export function code128Svg(text: string, opts: { moduleWidth?: number; height?: number; quiet?: number } = {}): string {
  const w = opts.moduleWidth ?? 2, h = opts.height ?? 90, q = (opts.quiet ?? 10) * w;
  const mods = code128Modules(text);
  let x = q, bars = '';
  mods.forEach((m, idx) => { if (idx % 2 === 0) bars += `<rect x="${x}" y="0" width="${m * w}" height="${h}"/>`; x += m * w; });
  const total = x + q, esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h + 26}" width="${total}" height="${h + 26}"><rect width="${total}" height="${h + 26}" fill="#fff"/><g fill="#000">${bars}</g><text x="${total / 2}" y="${h + 18}" text-anchor="middle" font-family="monospace" font-size="14" fill="#000">${esc}</text></svg>`;
}
