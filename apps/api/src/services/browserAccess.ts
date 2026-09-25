import crypto from 'node:crypto';

export const BROWSER_INVITE_TTL_MS = 30 * 60 * 1000;
export const BROWSER_LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BROWSER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function createBrowserInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashBrowserInviteToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createBrowserLoginCode(length = 8) {
  return Array.from({ length }, () => BROWSER_CODE_ALPHABET[crypto.randomInt(BROWSER_CODE_ALPHABET.length)]).join('');
}

export function normalizeBrowserLoginCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatBrowserLoginCode(code: string) {
  const normalized = normalizeBrowserLoginCode(code);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function hashBrowserLoginCode(code: string) {
  return crypto.createHash('sha256').update(normalizeBrowserLoginCode(code), 'utf8').digest('hex');
}

export function browserInviteExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BROWSER_INVITE_TTL_MS);
}

export function browserLoginCodeExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BROWSER_LOGIN_CODE_TTL_MS);
}

export function browserSessionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BROWSER_SESSION_TTL_MS);
}
