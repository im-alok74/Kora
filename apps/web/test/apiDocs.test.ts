import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS } from '@kora/core';

/**
 * The public API is described three times: the route files, apps/web/public/openapi.json and docs/api.md.
 * These tests fail when any two of them drift apart, so a new route cannot ship without being written down.
 */
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const repoRoot = join(webRoot, '..', '..');
const V1 = join(webRoot, 'app', 'api', 'v1');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type Spec = { paths: Record<string, Record<string, { summary?: string; responses?: object }>> };
const readSpec = (): Spec => JSON.parse(readFileSync(join(webRoot, 'public', 'openapi.json'), 'utf8')) as Spec;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** "METHOD /path" for every exported handler under app/api/v1. */
function routeOperations(): string[] {
  const out: string[] = [];
  for (const file of walk(V1).filter((f) => f.endsWith(`${sep}route.ts`))) {
    const path = '/' + relative(V1, dirname(file)).split(sep).join('/').replace(/\[(\w+)\]/g, '{$1}');
    const src = readFileSync(file, 'utf8');
    for (const m of METHODS) if (new RegExp(`export\\s+(const|async function)\\s+${m}\\b`).test(src)) out.push(`${m} ${path}`);
  }
  return out.sort();
}

function openapiOperations(): string[] {
  return Object.entries(readSpec().paths)
    .flatMap(([p, ops]) => Object.keys(ops).filter((k) => METHODS.includes(k.toUpperCase())).map((m) => `${m.toUpperCase()} ${p}`))
    .sort();
}

/** Rows like "| `GET /customers/{id}` | read | ..." in the Endpoints table of docs/api.md. */
function docOperations(): string[] {
  const md = readFileSync(join(repoRoot, 'docs', 'api.md'), 'utf8');
  const ops = [...md.matchAll(/^\|\s*`(GET|POST|PUT|PATCH|DELETE) (\/[^`?\s]*)[^`]*`\s*\|/gm)].map((m) => `${m[1]} ${m[2]}`);
  return [...new Set(ops)].sort();
}

describe('API descriptions agree with the routes', () => {
  it('has routes to compare', () => {
    expect(routeOperations().length).toBeGreaterThan(10);
  });

  it('openapi.json lists exactly the operations the routes export', () => {
    expect(openapiOperations()).toEqual(routeOperations());
  });

  it('docs/api.md lists exactly the operations the routes export', () => {
    expect(docOperations()).toEqual(routeOperations());
  });

  it('every openapi operation has a summary and at least one response', () => {
    for (const [p, ops] of Object.entries(readSpec().paths)) {
      for (const [m, op] of Object.entries(ops)) {
        if (!METHODS.includes(m.toUpperCase())) continue;
        expect(op.summary, `${m} ${p} needs a summary`).toBeTruthy();
        expect(Object.keys(op.responses ?? {}).length, `${m} ${p} needs responses`).toBeGreaterThan(0);
      }
    }
  });

  it('docs/api.md documents exactly the webhook events that can be sent', () => {
    const md = readFileSync(join(repoRoot, 'docs', 'api.md'), 'utf8');
    const section = md.split('## Webhooks')[1] ?? '';
    const documented = [...section.matchAll(/^\|\s*`((?:document|payment|estimate)\.[a-z_]+)`\s*\|/gm)].map((m) => m[1]).sort();
    expect(documented).toEqual([...WEBHOOK_EVENTS].sort());
  });
});
