import { describe, expect, it } from 'vitest';
import { passwordStrength } from '../lib/passwordStrength';

describe('password strength', () => {
  it('asks for more when it is empty or short', () => {
    expect(passwordStrength('').score).toBe(0);
    const s = passwordStrength('abc12');
    expect(s).toMatchObject({ score: 1, ok: false, label: 'Too short' });
    expect(s.tip).toContain('3 more characters');
  });
  it('flags common and personal passwords even when long enough', () => {
    expect(passwordStrength('password1').ok).toBe(false);
    expect(passwordStrength('Alok@sharma99', ['Alok Sharma']).label).toBe('Easy to guess');
    expect(passwordStrength('aaaaaaaaaa').ok).toBe(false);
    expect(passwordStrength('12345678').ok).toBe(false);
  });
  it('rates by length and variety, and never calls an 8-character lowercase password strong', () => {
    expect(passwordStrength('mangotree').score).toBe(2);
    expect(passwordStrength('mango-Tree-42').score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('correct horse battery staple 7').score).toBe(4);
    expect(passwordStrength('qazwsxed').ok).toBe(true);
  });
});
