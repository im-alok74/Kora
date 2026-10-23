/**
 * The installable apps on the Download page. The files are not kept in this repository: a release workflow builds them and attaches
 * them to a GitHub release whose tag starts with "app-v". This reads that release (cached for ten minutes) so the page only offers
 * what has really been published, with the real file size.
 */
export type Platform = 'windows' | 'mac' | 'android';
export type DownloadFile = { platform: Platform; name: string; url: string; sizeMb: number };
export type Downloads = { version: string | null; files: Partial<Record<Platform, DownloadFile>> };

const REPO = process.env.KORA_RELEASE_REPO ?? 'im-alok74/Kora';
const MATCH: Record<Platform, RegExp> = { windows: /\.exe$/i, mac: /\.dmg$/i, android: /\.apk$/i };

export async function getDownloads(): Promise<Downloads> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, { headers: { accept: 'application/vnd.github+json' }, next: { revalidate: 600 }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { version: null, files: {} };
    const releases = (await r.json()) as { tag_name: string; draft: boolean; prerelease: boolean; assets: { name: string; browser_download_url: string; size: number }[] }[];
    const rel = releases.find((x) => !x.draft && !x.prerelease && x.tag_name.startsWith('app-v') && x.assets.some((a) => Object.values(MATCH).some((pattern) => pattern.test(a.name))));
    if (!rel) return { version: null, files: {} };
    const files: Downloads['files'] = {};
    for (const p of Object.keys(MATCH) as Platform[]) {
      const a = rel.assets.find((x) => MATCH[p].test(x.name));
      if (a) files[p] = { platform: p, name: a.name, url: a.browser_download_url, sizeMb: Math.max(1, Math.round(a.size / 1_048_576)) };
    }
    return { version: rel.tag_name.replace(/^app-v/, ''), files };
  } catch {
    return { version: null, files: {} };
  }
}
