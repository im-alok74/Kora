/** Common English words that say little about a topic. Used only when the stop-word filter is on. */
export const STOP_WORDS = new Set((
  'a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also may might must shall us via per etc'
).split(' '));

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;

export type Entry = { text: string; count: number; density: number };
export type TextStats = {
  words: number; characters: number; charactersNoSpaces: number; sentences: number; paragraphs: number; lines: number;
  readingMinutes: number; speakingMinutes: number; uniqueWords: number; averageWordLength: number;
  keywords: Entry[]; twoWord: Entry[]; threeWord: Entry[];
};

/** Reading speed used for the estimate. A typical adult reads 200 to 250 words a minute; we use 200 so the time is not too short. */
export const READ_WPM = 200;
export const SPEAK_WPM = 130;

export const tokenize = (text: string) => text.match(WORD) ?? [];

function top(counts: Map<string, number>, total: number, limit: number, min: number): Entry[] {
  return [...counts]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count, density: total ? Math.round((count / total) * 10000) / 100 : 0 }));
}

/**
 * Counts and keyword density. Density is how often a word or phrase appears divided by the total number of words, as a percent.
 * With the stop-word filter on, single keywords skip common words and phrases cannot start or end with one.
 */
export function analyseText(text: string, o: { stopWords?: boolean; limit?: number } = {}): TextStats {
  const limit = o.limit ?? 10;
  const tokens = tokenize(text);
  const lower = tokens.map((w) => w.toLowerCase().replace(/’/g, "'"));
  const total = lower.length;
  const stop = (w: string) => !!o.stopWords && STOP_WORDS.has(w);
  const single = new Map<string, number>();
  for (const w of lower) if (!stop(w) && !/^\d+$/.test(w) && w.length > 1) single.set(w, (single.get(w) ?? 0) + 1);
  const gram = (n: number) => {
    const m = new Map<string, number>();
    for (let i = 0; i + n <= total; i++) {
      const a = lower[i]!, b = lower[i + n - 1]!;
      if (stop(a) || stop(b)) continue;
      const g = lower.slice(i, i + n).join(' ');
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const sentences = (text.match(/[^.!?।\n]+[.!?।]*/g) ?? []).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  const trimmed = text.trim();
  return {
    words: total,
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, '')].length,
    sentences,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0,
    lines: trimmed ? trimmed.split(/\r?\n/).length : 0,
    readingMinutes: total / READ_WPM,
    speakingMinutes: total / SPEAK_WPM,
    uniqueWords: new Set(lower).size,
    averageWordLength: total ? Math.round((tokens.join('').length / total) * 10) / 10 : 0,
    keywords: top(single, total, limit, 1),
    twoWord: top(gram(2), total, limit, 2),
    threeWord: top(gram(3), total, limit, 2),
  };
}

/** 0.4 -> "24 sec", 2.5 -> "2 min 30 sec", 0 -> "0 sec". */
export function minutesLabel(m: number): string {
  const s = Math.round(m * 60);
  if (s < 60) return `${s} sec`;
  const mins = Math.floor(s / 60), sec = s % 60;
  return sec ? `${mins} min ${sec} sec` : `${mins} min`;
}
