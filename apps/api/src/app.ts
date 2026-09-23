import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { bot, configureWebhook, initializeBot } from './bot.js';
import { env, telegramWebhookSecret } from './config.js';
import { prisma } from './db.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { generateRecurringTournaments } from './services/recurringTournaments.js';
import { databaseRateLimit } from './services/rateLimit.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.NODE_ENV !== 'production' || env.ALLOWED_WEB_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  }
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok', database: 'connected', service: 'poker-club-api', runtime: 'vercel' });
  } catch {
    return res.status(503).json({ status: 'degraded', database: 'unavailable', service: 'poker-club-api', runtime: 'vercel' });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  if (!bot) return res.status(503).json({ message: 'Telegram bot не настроен' });
  if (telegramWebhookSecret && req.header('x-telegram-bot-api-secret-token') !== telegramWebhookSecret) {
    return res.status(401).end();
  }
  await initializeBot();
  await bot.handleUpdate(req.body);
  return res.status(200).end();
});

function hasInternalAuthorization(authorization: string | undefined) {
  return Boolean(env.CRON_SECRET && authorization === `Bearer ${env.CRON_SECRET}`);
}

app.get('/api/cron/recurring-tournaments', async (req, res) => {
  if (!hasInternalAuthorization(req.header('authorization'))) return res.status(401).json({ message: 'Unauthorized' });
  const generated = await generateRecurringTournaments();
  const now = new Date();
  const [expiredDrafts, expiredRateLimits] = await Promise.all([
    prisma.broadcastDraft.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } })
  ]);
  return res.json({ ok: true, generated, cleanup: { broadcastDrafts: expiredDrafts.count, rateLimitBuckets: expiredRateLimits.count } });
});

app.post('/api/internal/telegram/setup', async (req, res) => {
  if (!hasInternalAuthorization(req.header('authorization'))) return res.status(401).json({ message: 'Unauthorized' });
  if (!bot) return res.status(503).json({ message: 'TELEGRAM_BOT_TOKEN не настроен' });
  await configureWebhook();
  const publicUrl = (env.PUBLIC_API_URL ?? env.MINI_APP_URL).replace(/\/$/, '');
  return res.json({ ok: true, webhook: `${publicUrl}/api/telegram/webhook` });
});

const authLimiter = databaseRateLimit({
  namespace: 'auth',
  windowMs: 15 * 60_000,
  limit: 30,
  message: 'Слишком много попыток входа. Повторите позже.'
});

app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/auth/telegram', authLimiter);
app.use('/api/auth/browser', authLimiter);
app.use('/api/auth/email', authLimiter);
app.use('/api/auth', authRouter);
app.use('/api', publicRouter);
app.use('/api/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ message: 'Маршрут не найден' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ message: 'Проверьте введённые данные', issues: error.issues });
  }
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }
  console.error(error);
  const message = env.NODE_ENV === 'production'
    ? 'Внутренняя ошибка сервера'
    : error instanceof Error ? error.message : 'Внутренняя ошибка сервера';
  return res.status(500).json({ message });
});

export default app;
