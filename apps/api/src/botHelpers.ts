import { createHash } from 'node:crypto';

export const PLAYER_BUTTONS = {
  openClub: '🎮 ОТКРЫТЬ КЛУБ',
  tournaments: '🏆 ТУРНИРЫ',
  profile: '👤 ПРОФИЛЬ',
  rating: '📊 РЕЙТИНГ',
  help: '🆘 ПОМОЩЬ',
  phone: '📱 ПОДЕЛИТЬСЯ НОМЕРОМ'
} as const;

export const ADMIN_BUTTONS = {
  panel: '🎛 ПАНЕЛЬ УПРАВЛЕНИЯ',
  tournaments: '🎟 ТУРНИРЫ',
  checkin: '✅ ЧЕК-ИН',
  seating: '🪑 РАССАДКА',
  players: '👥 ИГРОКИ',
  results: '📊 РЕЗУЛЬТАТЫ',
  broadcast: '🔔 РАССЫЛКА',
  audit: '🧾 АУДИТ',
  settings: '⚙️ НАСТРОЙКИ'
} as const;

export type MiniAppParams = Record<string, string | number | undefined>;

export function createRetryableInitializer(initializer: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  return async () => {
    pending ??= initializer().catch((error) => {
      pending = null;
      throw error;
    });
    await pending;
  };
}

const TELEGRAM_WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function normalizeTelegramWebhookSecret(value?: string) {
  if (!value) return undefined;
  if (TELEGRAM_WEBHOOK_SECRET_PATTERN.test(value)) return value;
  return createHash('sha256').update(value).digest('hex');
}

export function hasAdminAccess(telegramId: string | number, adminIds: ReadonlySet<string>) {
  return adminIds.has(String(telegramId));
}

export function miniAppUrl(baseUrl: string, path = '/', params: MiniAppParams = {}) {
  const base = new URL(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = normalizedPath;
  base.search = '';
  base.hash = '';
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value).trim()) base.searchParams.set(key, String(value));
  }
  return base.toString();
}

export function miniAppLaunchUrl(baseUrl: string, view?: 'games' | 'profile' | 'rating' | 'privileges') {
  return miniAppUrl(baseUrl, '/', view ? { view } : {});
}

export function normalizePhoneNumber(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export function displayName(user: { firstName: string; lastName?: string | null; username?: string | null; nickname?: string | null }) {
  if (user.nickname) return user.nickname;
  if (user.username) return `@${user.username}`;
  return `${user.firstName} ${user.lastName ?? ''}`.trim();
}

export function registrationLabel(input: {
  status: string;
  registrationClosed: boolean;
  registrationDeadline: Date | null;
  participantCount: number;
  capacity: number;
}, now = new Date()) {
  if (input.status === 'ACTIVE') {
    if (input.registrationClosed || (input.registrationDeadline && input.registrationDeadline <= now)) return 'поздняя регистрация закрыта';
    return input.participantCount >= input.capacity ? 'поздняя регистрация, лист ожидания' : 'поздняя регистрация открыта';
  }
  if (input.registrationClosed || (input.registrationDeadline && input.registrationDeadline <= now)) return 'регистрация закрыта';
  return input.participantCount >= input.capacity ? 'основной список заполнен, доступен лист ожидания' : 'регистрация открыта';
}
