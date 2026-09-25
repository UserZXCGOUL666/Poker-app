import 'dotenv/config';
import { z } from 'zod';
import { normalizeTelegramWebhookSecret } from './botHelpers.js';

function httpsUrlFromHost(host?: string) {
  const value = host?.trim();
  if (!value) return undefined;
  return value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/poker_club?schema=public'),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  CRON_SECRET: z.string().min(16).optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  MINI_APP_URL: z.string().url().optional(),
  PUBLIC_API_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  ADMIN_CONTACT: z.string().max(160).optional(),
  CLUB_TIMEZONE: z.string().default('Asia/Yekaterinburg'),
  CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().trim().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().trim().min(40).optional(),
  ALLOW_DEV_AUTH: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
}).superRefine((value, ctx) => {
  const cloudinaryValues = [value.CLOUDINARY_CLOUD_NAME, value.CLOUDINARY_API_KEY, value.CLOUDINARY_API_SECRET];
  if (cloudinaryValues.some(Boolean) && !cloudinaryValues.every(Boolean)) {
    ctx.addIssue({ code: 'custom', path: ['CLOUDINARY_CLOUD_NAME'], message: 'Для Cloudinary задайте cloud name, API key и API secret вместе' });
  }
  const googleValues = [value.GOOGLE_SERVICE_ACCOUNT_EMAIL, value.GOOGLE_PRIVATE_KEY];
  if (googleValues.some(Boolean) && !googleValues.every(Boolean)) {
    ctx.addIssue({ code: 'custom', path: ['GOOGLE_SERVICE_ACCOUNT_EMAIL'], message: 'Для Google Sheets задайте email service account и private key вместе' });
  }
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value.CLUB_TIMEZONE }).format();
  } catch {
    ctx.addIssue({ code: 'custom', path: ['CLUB_TIMEZONE'], message: 'Укажите корректный IANA-часовой пояс' });
  }
  if (value.NODE_ENV !== 'production') return;
  if (value.JWT_SECRET === 'dev-only-secret-change-me') {
    ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'В production задайте случайный JWT_SECRET' });
  }
  if (!value.CRON_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['CRON_SECRET'], message: 'В production задайте CRON_SECRET для внутренних Vercel-задач' });
  }
  const productionUrl = value.MINI_APP_URL
    ?? httpsUrlFromHost(value.VERCEL_PROJECT_PRODUCTION_URL)
    ?? httpsUrlFromHost(value.VERCEL_URL);
  if (!productionUrl?.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['MINI_APP_URL'], message: 'Production Mini App должна использовать HTTPS' });
  }
  if (value.TELEGRAM_BOT_TOKEN && !value.TELEGRAM_WEBHOOK_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'Для production webhook нужен секрет' });
  }
});

const parsed = schema.parse(process.env);
const miniAppUrl = parsed.MINI_APP_URL
  ?? httpsUrlFromHost(parsed.VERCEL_PROJECT_PRODUCTION_URL)
  ?? httpsUrlFromHost(parsed.VERCEL_URL)
  ?? 'http://localhost:5173';

const allowedOrigins = new Set<string>([miniAppUrl.replace(/\/$/, '')]);
for (const host of [parsed.VERCEL_URL, parsed.VERCEL_BRANCH_URL, parsed.VERCEL_PROJECT_PRODUCTION_URL]) {
  const url = httpsUrlFromHost(host);
  if (url) allowedOrigins.add(url.replace(/\/$/, ''));
}

export const env = {
  ...parsed,
  MINI_APP_URL: miniAppUrl.replace(/\/$/, ''),
  ALLOWED_WEB_ORIGINS: allowedOrigins
};

export const telegramWebhookSecret = normalizeTelegramWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET);
export const adminTelegramIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(',').map((value) => value.trim()).filter(Boolean)
);
