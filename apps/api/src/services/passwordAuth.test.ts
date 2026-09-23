import { describe, expect, it } from 'vitest';
import { hashPassword, normalizeEmail, verifyPassword } from './passwordAuth.js';

describe('password authentication', () => {
  it('normalizes email consistently', () => {
    expect(normalizeEmail('  Player@Example.COM ')).toBe('player@example.com');
  });

  it('hashes and verifies passwords without storing the original value', async () => {
    const password = 'RiverFox-2026';
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('password', 'not-a-valid-hash')).toBe(false);
  });
});
