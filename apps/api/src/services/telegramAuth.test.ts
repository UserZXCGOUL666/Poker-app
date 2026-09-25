import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from './telegramAuth.js';

function sign(params: URLSearchParams, token: string) {
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

describe('validateTelegramInitData', () => {
  it('проверяет корректную подпись', () => {
    const token = '123:test-token';
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'test',
      user: JSON.stringify({ id: 42, first_name: 'Test' })
    });
    params.set('hash', sign(params, token));
    expect(validateTelegramInitData(params.toString(), token).id).toBe(42);
  });

  it('отклоняет подменённые данные', () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: '{"id":42}', hash: '00'.repeat(32) });
    expect(() => validateTelegramInitData(params.toString(), 'token')).toThrow();
  });

  it('отклоняет корректно подписанные данные с датой из будущего', () => {
    const token = '123:test-token';
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000) + 600),
      user: JSON.stringify({ id: 42, first_name: 'Test' })
    });
    params.set('hash', sign(params, token));
    expect(() => validateTelegramInitData(params.toString(), token)).toThrow('устарели');
  });
});
