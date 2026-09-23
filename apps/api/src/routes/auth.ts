import { Router } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { adminTelegramIds, env } from '../config.js';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { createAccessToken, requireAuth } from '../middleware/auth.js';
import {
  browserSessionExpiresAt,
  hashBrowserInviteToken,
  hashBrowserLoginCode,
  normalizeBrowserLoginCode
} from '../services/browserAccess.js';
import { validateTelegramInitData, type TelegramUserData } from '../services/telegramAuth.js';
import { createReferralForNewUser, ensureReferralCode, recordDailyAppOpen } from '../services/loyalty.js';
import { getBotUsername } from '../bot.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword, normalizeEmail, verifyPassword } from '../services/passwordAuth.js';

export const authRouter = Router();

const bodySchema = z.object({
  initData: z.string().optional(),
  referralCode: z.string().trim().max(32).optional(),
  devUser: z.object({
    id: z.coerce.number().int().positive(),
    first_name: z.string().default('Алексей'),
    last_name: z.string().optional(),
    username: z.string().optional()
  }).optional()
});

authRouter.post('/telegram', async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);
    let telegramUser: TelegramUserData;

    if (body.initData && env.TELEGRAM_BOT_TOKEN) {
      telegramUser = validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
    } else if (env.NODE_ENV !== 'production' && env.ALLOW_DEV_AUTH && body.devUser) {
      telegramUser = body.devUser;
    } else {
      return res.status(401).json({ message: 'Откройте приложение через Telegram' });
    }

    const telegramId = String(telegramUser.id);
    const existingUser = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
    const role = adminTelegramIds.has(telegramId) ? UserRole.ADMIN : UserRole.PLAYER;
    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        role
      },
      create: {
        telegramId: BigInt(telegramId),
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        role
      }
    });

    await ensureReferralCode(user.id);
    if (!existingUser) await createReferralForNewUser(user.id, body.referralCode);
    await recordDailyAppOpen(user.id).catch((error) => console.error('Не удалось записать открытие приложения', error));

    const token = createAccessToken({ sub: user.id, telegramId, role: user.role, authMethod: 'telegram' });
    return res.json({ token, user: serializeUser(user) });
  } catch (error) {
    return next(error);
  }
});

const browserExchangeSchema = z.object({ token: z.string().min(40).max(256) });

authRouter.get('/browser/config', async (_req, res) => {
  const botUsername = await getBotUsername();
  return res.json({ botUsername, botUrl: botUsername ? `https://t.me/${botUsername}?start=browser_login` : null });
});

const emailRegisterSchema = z.object({
  firstName: z.string().trim().min(2, 'Укажите имя или никнейм').max(50),
  email: z.string().trim().email('Проверьте адрес электронной почты').max(254),
  password: z.string().min(8, 'Пароль должен содержать минимум 8 символов').max(128),
  referralCode: z.string().trim().max(32).optional()
});

const emailLoginSchema = z.object({
  email: z.string().trim().email('Проверьте адрес электронной почты').max(254),
  password: z.string().min(1).max(128)
});

async function createEmailSession(userId: string) {
  return prisma.browserSession.create({
    data: { userId, expiresAt: browserSessionExpiresAt(new Date()) }
  });
}

authRouter.post('/email/register', async (req, res, next) => {
  try {
    const input = emailRegisterSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (existing) throw new AppError('Аккаунт с такой почтой уже существует', 409, 'EMAIL_ALREADY_EXISTS');

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          telegramId: null,
          email,
          passwordHash,
          firstName: input.firstName,
          nickname: input.firstName,
          role: UserRole.PLAYER
        }
      });
      const session = await tx.browserSession.create({
        data: { userId: user.id, expiresAt: browserSessionExpiresAt(new Date()) }
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: 'EMAIL_ACCOUNT_CREATED',
        entityType: 'User',
        entityId: user.id,
        summary: `${user.firstName} зарегистрировался по электронной почте`,
        metadata: { authMethod: 'email' }
      });
      return { user, session };
    });
    await ensureReferralCode(result.user.id).catch((error) => console.error('Не удалось создать реферальный код email-профиля', error));
    await createReferralForNewUser(result.user.id, input.referralCode).catch((error) => console.error('Не удалось применить реферальный код email-профиля', error));
    await recordDailyAppOpen(result.user.id).catch((error) => console.error('Не удалось записать открытие приложения', error));
    const token = createAccessToken({
      sub: result.user.id,
      telegramId: null,
      role: UserRole.PLAYER,
      authMethod: 'email',
      sessionId: result.session.id
    }, '30d');
    return res.status(201).json({ token, user: serializeUser(result.user), expiresAt: result.session.expiresAt });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(new AppError('Аккаунт с такой почтой уже существует', 409, 'EMAIL_ALREADY_EXISTS'));
    }
    return next(error);
  }
});

authRouter.post('/email/login', async (req, res, next) => {
  try {
    const input = emailLoginSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user?.passwordHash || !await verifyPassword(input.password, user.passwordHash)) {
      throw new AppError('Неверная почта или пароль', 401, 'INVALID_EMAIL_CREDENTIALS');
    }
    if (user.role !== UserRole.PLAYER) {
      await prisma.user.update({ where: { id: user.id }, data: { role: UserRole.PLAYER } });
      user.role = UserRole.PLAYER;
    }
    const session = await createEmailSession(user.id);
    await recordDailyAppOpen(user.id).catch((error) => console.error('Не удалось записать открытие приложения', error));
    const token = createAccessToken({
      sub: user.id,
      telegramId: null,
      role: UserRole.PLAYER,
      authMethod: 'email',
      sessionId: session.id
    }, '30d');
    return res.json({ token, user: serializeUser(user), expiresAt: session.expiresAt });
  } catch (error) {
    return next(error);
  }
});

authRouter.post('/browser/exchange', async (req, res, next) => {
  try {
    const { token } = browserExchangeSchema.parse(req.body);
    const now = new Date();
    const tokenHash = hashBrowserInviteToken(token);
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.browserAccessInvite.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        include: { user: true }
      });
      if (!invite) throw new AppError('Ссылка недействительна, уже использована или истекла', 401, 'INVALID_BROWSER_INVITE');

      const claimed = await tx.browserAccessInvite.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) throw new AppError('Ссылка уже использована', 401, 'USED_BROWSER_INVITE');

      const session = await tx.browserSession.create({
        data: { userId: invite.userId, expiresAt: browserSessionExpiresAt(now) }
      });
      return { user: invite.user, session };
    });

    if (!result.user.telegramId) throw new AppError('Для этой ссылки не найден Telegram-профиль', 401, 'INVALID_BROWSER_INVITE');
    const telegramId = result.user.telegramId.toString();
    const role = adminTelegramIds.has(telegramId) ? UserRole.ADMIN : UserRole.PLAYER;
    const user = result.user.role === role
      ? result.user
      : await prisma.user.update({ where: { id: result.user.id }, data: { role } });
    const accessToken = createAccessToken({
      sub: user.id,
      telegramId,
      role: user.role,
      authMethod: 'browser',
      sessionId: result.session.id
    }, '30d');
    return res.json({ token: accessToken, user: serializeUser(user), expiresAt: result.session.expiresAt });
  } catch (error) {
    return next(error);
  }
});

const browserCodeExchangeSchema = z.object({ code: z.string().trim().min(8).max(16) });

authRouter.post('/browser/code/exchange', async (req, res, next) => {
  try {
    const { code: rawCode } = browserCodeExchangeSchema.parse(req.body);
    const code = normalizeBrowserLoginCode(rawCode);
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) {
      throw new AppError('Проверьте восьмизначный код из Telegram', 400, 'INVALID_BROWSER_CODE_FORMAT');
    }
    const now = new Date();
    const codeHash = hashBrowserLoginCode(code);
    const result = await prisma.$transaction(async (tx) => {
      const loginCode = await tx.browserLoginCode.findFirst({
        where: { codeHash, usedAt: null, expiresAt: { gt: now } },
        include: { user: true }
      });
      if (!loginCode) throw new AppError('Код недействителен, уже использован или истёк', 401, 'INVALID_BROWSER_CODE');

      const claimed = await tx.browserLoginCode.updateMany({
        where: { id: loginCode.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (claimed.count !== 1) throw new AppError('Код уже использован', 401, 'USED_BROWSER_CODE');

      const session = await tx.browserSession.create({ data: { userId: loginCode.userId, expiresAt: browserSessionExpiresAt(now) } });
      await writeAudit(tx, {
        actorId: loginCode.userId, action: 'BROWSER_CODE_USED', entityType: 'BrowserSession', entityId: session.id,
        summary: `${loginCode.user.firstName} вошёл в браузере по коду из Telegram`,
        metadata: { loginCodeId: loginCode.id }
      });
      return { user: loginCode.user, session };
    });

    if (!result.user.telegramId) throw new AppError('Для этого кода не найден Telegram-профиль', 401, 'INVALID_BROWSER_CODE');
    const telegramId = result.user.telegramId.toString();
    const role = adminTelegramIds.has(telegramId) ? UserRole.ADMIN : UserRole.PLAYER;
    const user = result.user.role === role ? result.user : await prisma.user.update({ where: { id: result.user.id }, data: { role } });
    const accessToken = createAccessToken({ sub: user.id, telegramId, role: user.role, authMethod: 'browser', sessionId: result.session.id }, '30d');
    return res.json({ token: accessToken, user: serializeUser(user), expiresAt: result.session.expiresAt });
  } catch (error) { return next(error); }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  let user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  const expectedRole = user.telegramId && adminTelegramIds.has(user.telegramId.toString()) ? UserRole.ADMIN : UserRole.PLAYER;
  if (user.role !== expectedRole) {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: expectedRole } });
  }
  return res.json(serializeUser(user));
});

function serializeUser(user: { id: string; telegramId: bigint | null; email: string | null; username: string | null; nickname: string | null; firstName: string; lastName: string | null; photoUrl: string | null; role: UserRole; points: number; clubXp: number }) {
  return {
    id: user.id,
    telegramId: user.telegramId?.toString() ?? null,
    email: user.email,
    username: user.username,
    nickname: user.nickname,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    role: user.role,
    points: user.points,
    clubXp: user.clubXp
  };
}
