import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Dockerfile'), 'utf8');
const lines = text.split(/\r?\n/);

describe('Dockerfile', () => {
  it('never runs as root in the final images', () => {
    expect(lines.some((l) => /^USER\s+root\b/i.test(l))).toBe(false);
    expect(lines.some((l) => /^USER\s+kora\b/.test(l))).toBe(true);
  });

  it('has a worker target and ends with the web target, so no --target gives the web app', () => {
    const stages = lines.filter((l) => /^FROM\s/i.test(l)).map((l) => /\sAS\s+(\S+)/i.exec(l)?.[1]);
    expect(stages).toContain('worker');
    expect(stages[stages.length - 1]).toBe('web');
    expect(text).toContain('@kora/worker');
  });

  it('keeps Chromium and the package manager readable by the unprivileged user', () => {
    expect(text).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(text).toContain('COREPACK_HOME=/opt/corepack');
    expect(text).toMatch(/chown -R kora:kora[^\n]*\/ms-playwright[^\n]*\/opt\/corepack/);
  });
});
