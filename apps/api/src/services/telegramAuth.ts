import crypto from 'node:crypto';

export type TelegramUserData = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60
): TelegramUserData {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash отсутствует');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const left = Buffer.from(calculatedHash, 'hex');
  const right = Buffer.from(receivedHash, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('Подпись Telegram недействительна');
  }

  const authDate = Number(params.get('auth_date'));
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    throw new Error('Данные Telegram устарели');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Пользователь Telegram отсутствует');
  return JSON.parse(rawUser) as TelegramUserData;
}
