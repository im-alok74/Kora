import { describe, expect, it } from 'vitest';
import { isHeavyPath, userRateCheck } from '../lib/userLimit';

describe('userRateCheck', () => {
  it('lets ordinary use through and stops a burst, per person', () => {
    const t = 1_000_000;
    for (let i = 0; i < 600; i++) expect(userRateCheck('u-burst', '/api/documents', t)).toBe(0);
    expect(userRateCheck('u-burst', '/api/documents', t + 1000)).toBeGreaterThan(0);
    expect(userRateCheck('u-other', '/api/documents', t + 1000)).toBe(0);      // someone else is unaffected
    expect(userRateCheck('u-burst', '/api/documents', t + 61_000)).toBe(0);   // and the window resets
  });
  it('keeps a lower limit for work-heavy routes, counted apart from ordinary ones', () => {
    const t = 5_000_000;
    for (let i = 0; i < 40; i++) expect(userRateCheck('u-heavy', '/api/reports/gstr1', t)).toBe(0);
    expect(userRateCheck('u-heavy', '/api/reports/gstr1', t)).toBeGreaterThan(0);
    expect(userRateCheck('u-heavy', '/api/documents', t)).toBe(0);
  });
  it('knows which routes are heavy', () => {
    for (const p of ['/api/reports/ageing', '/api/data/export', '/api/data/import', '/api/parties/export', '/api/documents/bulk', '/api/documents/abc/pdf']) expect(isHeavyPath(p), p).toBe(true);
    for (const p of ['/api/documents', '/api/parties', '/api/me', '/api/ca/engagements', '/api/search']) expect(isHeavyPath(p), p).toBe(false);
  });
});
