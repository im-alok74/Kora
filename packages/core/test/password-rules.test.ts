import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../src/password-rules.js';

describe('passwordProblem', () => {
  it('refuses the passwords that are guessed first, including the ones the attack test got through', () => {
    for (const pw of ['12345678', 'password', 'Passw0rd', 'aaaaaaaaaaaa', 'P@ssw0rd!', 'password123', 'Welcome1', 'Qwerty123', 'qwertyuiop', 'iloveyou1', 'Admin@123', 'letmein!!', 'abcd1234', '123456789012', 'India@2026', 'kora1234', 'Kora@123']) {
      expect(passwordProblem(pw), pw).not.toBeNull();
    }
  });
  it('refuses a password built from the person\'s own details', () => {
    expect(passwordProblem('rahul.sharma@2026', ['Rahul Sharma', 'rahul.sharma@example.com'])).toMatch(/name, email/);
    expect(passwordProblem('9876543210abc', ['9876543210'])).toMatch(/phone number/);
  });
  it('accepts ordinary good passwords, including long phrases and ones that merely contain a common word', () => {
    for (const pw of ['correct horse battery staple', 'T7#mQz!pL2vR', 'blue-tiger-ledger-41', 'MyDogLovesMangoes88', 'sunset over the Arabian Sea', 'k9Rr4tW2xPq8']) {
      expect(passwordProblem(pw, ['Asha Rao', 'asha@example.com']), pw).toBeNull();
    }
  });
});
