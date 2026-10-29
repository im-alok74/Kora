import { describe, expect, it } from 'vitest';
import { badInputMessage, MAX_BODY_BYTES } from '../lib/badInput';

describe('badInputMessage', () => {
  it('names a body that is not JSON', () => {
    expect(() => JSON.parse('{"a":')).toThrow();
    try { JSON.parse('{"a":'); } catch (e) { expect(badInputMessage(e)).toMatch(/not valid JSON/); }
  });
  it('names Postgres data exceptions: NUL characters, out-of-range numbers, bad dates, negative LIMIT', () => {
    for (const code of ['22021', '22003', '22007', '22008', '2201W', '2201X', '22001']) expect(badInputMessage({ code }), code).toMatch(/not acceptable/);
  });
  it('leaves everything else alone, including a malformed id (handled as not found) and ordinary server faults', () => {
    for (const e of [{ code: '22P02' }, { code: '23505' }, { code: '42P01' }, new Error('boom'), null, undefined, 'x']) expect(badInputMessage(e)).toBeNull();
  });
  it('caps bodies well above the largest real upload and well below anything that could hurt', () => {
    expect(MAX_BODY_BYTES).toBeGreaterThan(3 * 1024 * 1024);
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});
