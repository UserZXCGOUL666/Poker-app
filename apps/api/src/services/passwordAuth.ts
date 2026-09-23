import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const VERSION = 'scrypt-v1';

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${VERSION}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [version, saltValue, keyValue] = stored.split('$');
  if (version !== VERSION || !saltValue || !keyValue) return false;
  try {
    const expected = Buffer.from(keyValue, 'base64url');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
