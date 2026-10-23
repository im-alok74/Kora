import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDownloads } from '../lib/downloads';

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/im-alok74/Kora/releases/download/app-v1/${name}`, size: 2_097_152 });
const release = (tag_name: string, names: string[], extra = {}) => ({ tag_name, draft: false, prerelease: false, assets: names.map(asset), ...extra });
afterEach(() => vi.unstubAllGlobals());

describe('public app downloads', () => {
  it('skips drafts, previews and releases without installers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [
      release('app-v4', ['app.exe'], { draft: true }),
      release('app-v3', ['app.exe'], { prerelease: true }),
      release('app-v2', ['checksums.txt']),
      release('app-v1', ['Kora.exe', 'Kora.dmg', 'Kora.apk']),
    ] }));
    const result = await getDownloads();
    expect(result.version).toBe('1');
    expect(Object.keys(result.files)).toEqual(['windows', 'mac', 'android']);
    expect(result.files.windows).toMatchObject({ name: 'Kora.exe', sizeMb: 2 });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('only offers assets actually present in a stable release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [release('app-v1', ['Kora.apk'])] }));
    expect((await getDownloads()).files.windows).toBeUndefined();
  });
  it.each(['rate-limit', 'timeout', 'malformed'])('keeps browser installation available on %s', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'timeout') throw new Error('timeout');
      return { ok: failure !== 'rate-limit', json: async () => ({ message: 'invalid' }) };
    }));
    expect(await getDownloads()).toEqual({ version: null, files: {} });
  });
});
