import { describe, expect, it } from 'vitest';
import {
  BROWSER_INVITE_TTL_MS,
  BROWSER_LOGIN_CODE_TTL_MS,
  BROWSER_SESSION_TTL_MS,
  browserInviteExpiresAt,
  browserLoginCodeExpiresAt,
  browserSessionExpiresAt,
  createBrowserLoginCode,
  createBrowserInviteToken,
  formatBrowserLoginCode,
  hashBrowserLoginCode,
  hashBrowserInviteToken
} from './browserAccess.js';

describe('browser access tokens', () => {
  it('создаёт криптографически случайный токен и хранит только его хеш', () => {
    const first = createBrowserInviteToken();
    const second = createBrowserInviteToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashBrowserInviteToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashBrowserInviteToken(first)).toBe(hashBrowserInviteToken(first));
  });

  it('ограничивает приглашение 30 минутами, а сессию 30 днями', () => {
    const now = new Date('2026-07-19T12:00:00.000Z');
    expect(browserInviteExpiresAt(now).getTime() - now.getTime()).toBe(BROWSER_INVITE_TTL_MS);
    expect(browserLoginCodeExpiresAt(now).getTime() - now.getTime()).toBe(BROWSER_LOGIN_CODE_TTL_MS);
    expect(browserSessionExpiresAt(now).getTime() - now.getTime()).toBe(BROWSER_SESSION_TTL_MS);
  });

  it('создаёт удобный одноразовый код без неоднозначных символов', () => {
    const code = createBrowserLoginCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    expect(formatBrowserLoginCode(code)).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(hashBrowserLoginCode(formatBrowserLoginCode(code))).toBe(hashBrowserLoginCode(code));
  });
});
