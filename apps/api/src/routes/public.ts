import { Router } from 'express';
import { Prisma, TournamentRegistrationStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { cancelTournamentRegistration, registerForTournament } from '../services/registrations.js';
import { notifyUser, registrationNotification } from '../bot.js';
import { getBotUsername } from '../bot.js';
import { z } from 'zod';
import { achievementProgressValue, answerDailyHand, ensureReferralCode, evaluateAchievements, getDailyContent, getPlayerLoyaltyStats } from '../services/loyalty.js';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { writeAudit } from '../services/audit.js';
import { deleteProfilePhoto, uploadProfilePhoto } from '../services/profilePhotos.js';
import { timerPublicRouter } from './timerPublic.js';
import { appendTrainingLeadToSheet } from '../services/googleSheets.js';

export const publicRouter = Router();

publicRouter.get('/branding/rating-banner', async (_req, res) => {
  const settings = await prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { ratingBannerImageData: true, updatedAt: true } });
  const match = settings?.ratingBannerImageData?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(404).end();
  const image = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Content-Length', image.length);
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  if (settings) res.setHeader('Last-Modified', settings.updatedAt.toUTCString());
  return res.send(image);
});

publicRouter.get('/branding/theme', async (_req, res) => {
  const settings = await prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { accentColor: true, updatedAt: true } });
  return res.json({ accentColor: settings?.accentColor ?? '#FF3D0A', updatedAt: settings?.updatedAt ?? null });
});

publicRouter.get('/users/:id/avatar', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { profilePhotoData: true } });
  const match = user?.profilePhotoData?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(404).end();
  const image = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Content-Length', image.length);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(image);
});

// Телевизионное табло не содержит персональных данных и доступно по прямой ссылке.
publicRouter.use('/tournaments', timerPublicRouter);
publicRouter.use(requireAuth);

const trainingLeadSchema = z.object({
  fullName: z.string().trim().min(3, 'Укажите ФИО').max(120),
  phoneNumber: z.string().trim().min(6, 'Укажите номер телефона').max(40),
  preferredContactAt: z.string().trim().min(2, 'Укажите удобное время для связи').max(160),
  preferredVisitAt: z.string().trim().min(2, 'Укажите удобное время для обучения').max(160)
});

publicRouter.get('/training-lead/config', async (req, res) => {
  const [settings, latestLead] = await Promise.all([
    prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { trainingLeadPopupEnabled: true, trainingSheetUrl: true } }),
    prisma.trainingLead.findFirst({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } })
  ]);
  return res.json({
    enabled: Boolean(settings?.trainingLeadPopupEnabled),
    configured: Boolean(settings?.trainingSheetUrl),
    submitted: Boolean(latestLead),
    submittedAt: latestLead?.createdAt ?? null
  });
});

publicRouter.post('/training-leads', async (req, res, next) => {
  try {
    const input = trainingLeadSchema.parse(req.body);
    const [settings, user] = await Promise.all([
      prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { trainingLeadPopupEnabled: true, trainingSheetUrl: true } }),
      prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, firstName: true, lastName: true, username: true, nickname: true } })
    ]);
    if (!settings?.trainingLeadPopupEnabled) throw new AppError('Запись на обучение сейчас закрыта', 409, 'TRAINING_LEADS_DISABLED');
    if (!user) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');

    const lead = await prisma.trainingLead.create({
      data: { userId: user.id, ...input }
    });

    if (settings.trainingSheetUrl) {
      const userLabel = user.username ? `@${user.username}` : user.nickname || [user.firstName, user.lastName].filter(Boolean).join(' ');
      try {
        await appendTrainingLeadToSheet({
          sheetUrl: settings.trainingSheetUrl,
          createdAt: lead.createdAt,
          fullName: lead.fullName,
          phoneNumber: lead.phoneNumber,
          preferredContactAt: lead.preferredContactAt,
          preferredVisitAt: lead.preferredVisitAt,
          userLabel,
          userId: user.id
        });
        await prisma.trainingLead.update({ where: { id: lead.id }, data: { sheetSyncedAt: new Date(), sheetSyncError: null } });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Неизвестная ошибка Google Sheets';
        await prisma.trainingLead.update({ where: { id: lead.id }, data: { sheetSyncError: message } });
        console.error('Не удалось отправить заявку на обучение в Google Sheets', error);
      }
    }

    return res.status(201).json({ id: lead.id, createdAt: lead.createdAt });
  } catch (error) { return next(error); }
});

const userSelect = { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true, points: true } as const;

publicRouter.get('/home', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { ...userSelect, clubXp: true } });
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [season, nextTournament, leaders, usersAhead, totalUsers, weeklyResult, finalTables, gamesPlayed, wins, branding, nextSeating] = await Promise.all([
    prisma.season.findFirst({ where: { isActive: true }, orderBy: { startsAt: 'desc' } }),
    prisma.tournament.findFirst({
      where: { status: 'UPCOMING', startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: {
        registrations: { where: { userId: req.auth!.userId }, take: 1 },
        _count: {
          select: {
            registrations: {
              where: { status: { in: [TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.PLAYED] } }
            }
          }
        }
      }
    }),
    prisma.user.findMany({ orderBy: [{ points: 'desc' }, { createdAt: 'asc' }], take: 5, select: userSelect }),
    prisma.user.count({ where: { points: { gt: user.points } } }),
    prisma.user.count(),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, season: { isActive: true }, createdAt: { gte: weekAgo } }, _sum: { amount: true } }),
    prisma.tournamentResult.count({ where: { userId: user.id, isFinalTable: true, tournament: { season: { isActive: true } } } }),
    prisma.tournamentResult.count({ where: { userId: user.id, tournament: { season: { isActive: true } } } }),
    prisma.tournamentResult.count({ where: { userId: user.id, place: 1, tournament: { season: { isActive: true } } } }),
    prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { ratingBannerImageData: true, accentColor: true, updatedAt: true } }),
    prisma.tournamentSeat.findFirst({
      where: { userId: user.id, tournament: { seatingPublishedAt: { not: null }, status: { in: ['UPCOMING', 'ACTIVE'] }, startsAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } } },
      orderBy: { tournament: { startsAt: 'asc' } },
      select: { seatNumber: true, table: { select: { number: true } }, tournament: { select: { id: true, title: true, startsAt: true } } }
    })
  ]);
  return res.json({
    season,
    week: season ? Math.max(1, Math.ceil((Date.now() - season.startsAt.getTime()) / (7 * 24 * 60 * 60 * 1000))) : 1,
    user: { ...user, rank: usersAhead + 1, totalUsers },
    nextTournament: nextTournament ? {
      ...nextTournament,
      participantCount: nextTournament._count.registrations,
      registration: nextTournament.registrations[0] ?? null,
      registrations: undefined,
      _count: undefined
    } : null,
    weeklyPoints: weeklyResult._sum.amount ?? 0,
    finalTables,
    gamesPlayed,
    wins,
    leaders,
    branding: { hasRatingBanner: Boolean(branding?.ratingBannerImageData), accentColor: branding?.accentColor ?? '#FF3D0A', updatedAt: branding?.updatedAt ?? null },
    nextSeating
  });
});

publicRouter.get('/tournaments', async (req, res) => {
  const tournaments = await prisma.tournament.findMany({
    include: {
      season: { select: { name: true } },
      registrations: { where: { userId: req.auth!.userId }, take: 1 },
      timer: { select: { id: true } },
      _count: { select: { results: true, registrations: { where: { status: { in: [TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.PLAYED] } } } } }
    },
    orderBy: { startsAt: 'desc' }
  });
  const waitlisted = await prisma.tournamentRegistration.findMany({
    where: { tournamentId: { in: tournaments.map((item) => item.id) }, status: TournamentRegistrationStatus.WAITLISTED },
    orderBy: [{ tournamentId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, tournamentId: true, userId: true }
  });
  const waitlistPosition = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const entry of waitlisted) {
    const position = (counters.get(entry.tournamentId) ?? 0) + 1;
    counters.set(entry.tournamentId, position);
    if (entry.userId === req.auth!.userId) waitlistPosition.set(entry.id, position);
  }
  return res.json(tournaments.map(({ registrations, ...tournament }) => ({
    ...tournament,
    timerAvailable: Boolean(tournament.timer),
    timer: undefined,
    participantCount: tournament._count.registrations,
    registration: registrations[0] ? { ...registrations[0], waitlistPosition: waitlistPosition.get(registrations[0].id) ?? null } : null
  })));
});

publicRouter.post('/tournaments/:id/registration', async (req, res, next) => {
  try {
    const result = await registerForTournament(req.params.id, req.auth!.userId, { actorId: req.auth!.userId, actorIsAdmin: false });
    const notification = result.duplicate ? null : await notifyUser(result.user.telegramId, registrationNotification(result.tournament.title, result.tournament.startsAt, result.registration.status === TournamentRegistrationStatus.WAITLISTED ? 'WAITLISTED' : 'REGISTERED'));
    return res.status(result.duplicate ? 200 : 201).json({ registration: result.registration, notification });
  } catch (error) { return next(error); }
});

publicRouter.delete('/tournaments/:id/registration', async (req, res, next) => {
  try {
    const registration = await prisma.tournamentRegistration.findUnique({ where: { tournamentId_userId: { tournamentId: req.params.id, userId: req.auth!.userId } } });
    if (!registration) return res.status(404).json({ message: 'Вы не записаны на этот турнир' });
    const result = await cancelTournamentRegistration(registration.id, { actorId: req.auth!.userId, actorIsAdmin: false, requestedByUserId: req.auth!.userId });
    const notification = result.duplicate ? null : await notifyUser(result.user.telegramId, registrationNotification(result.tournament.title, result.tournament.startsAt, 'CANCELLED'));
    const promotionNotification = result.promoted
      ? await notifyUser(result.promoted.user.telegramId, registrationNotification(result.tournament.title, result.tournament.startsAt, 'PROMOTED'))
      : null;
    return res.json({ registration: result.registration, notification, promotionNotification });
  } catch (error) { return next(error); }
});

publicRouter.get('/leaderboard', async (req, res) => {
  const period = req.query.period === 'week' ? 'week' : 'season';
  if (period === 'season') {
    const users = await prisma.user.findMany({ orderBy: [{ points: 'desc' }, { createdAt: 'asc' }], select: userSelect });
    return res.json(users.map((user, index) => ({ ...user, rank: index + 1 })));
  }
  const sums = await prisma.pointTransaction.groupBy({
    by: ['userId'],
    where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, season: { isActive: true } },
    _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }
  });
  const users = await prisma.user.findMany({ where: { id: { in: sums.map((item) => item.userId) } }, select: userSelect });
  const map = new Map(users.map((user) => [user.id, user]));
  return res.json(sums.map((item, index) => ({ ...map.get(item.userId), points: item._sum.amount ?? 0, rank: index + 1 })));
});

publicRouter.get('/loyalty/daily', async (req, res, next) => {
  try {
    const excludeTipId = typeof req.query.excludeTipId === 'string' && req.query.excludeTipId.length <= 100
      ? req.query.excludeTipId
      : undefined;
    return res.json(await getDailyContent(req.auth!.userId, new Date(), { excludeTipId }));
  }
  catch (error) { return next(error); }
});

const dailyAnswerSchema = z.object({ optionId: z.string().min(1).max(100) });
publicRouter.post('/loyalty/daily/answer', async (req, res, next) => {
  try {
    const { optionId } = dailyAnswerSchema.parse(req.body);
    return res.json(await answerDailyHand(req.auth!.userId, optionId));
  } catch (error) { return next(error); }
});

publicRouter.get('/loyalty/referral', async (req, res, next) => {
  try {
    const referralCode = await ensureReferralCode(req.auth!.userId);
    const [botUsername, referrals, settings] = await Promise.all([
      getBotUsername(),
      prisma.referral.findMany({
        where: { referrerId: req.auth!.userId },
        orderBy: { createdAt: 'desc' },
        include: { invitedUser: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } } }
      }),
      prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } })
    ]);
    const shareLink = botUsername ? `https://t.me/${botUsername}?start=ref_${referralCode}` : null;
    return res.json({
      referralCode,
      shareLink,
      fallbackMiniAppUrl: `${env.MINI_APP_URL}${env.MINI_APP_URL.includes('?') ? '&' : '?'}ref=${referralCode}`,
      rewardXp: settings.referralInviterXp,
      inviteeRewardXp: settings.referralInviteeXp,
      enabled: settings.referralEnabled,
      referrals
    });
  } catch (error) { return next(error); }
});

publicRouter.get('/profile', async (req, res) => {
  await evaluateAchievements(req.auth!.userId).catch((error) => console.error('Не удалось обновить достижения профиля', error));
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: {
      ...userSelect,
      telegramId: true,
      email: true,
      role: true,
      clubXp: true,
      referralCode: true,
      createdAt: true,
      phoneNumber: true,
      phoneSharedAt: true,
      results: { include: { tournament: true }, orderBy: { createdAt: 'desc' }, take: 50 },
      pointTransactions: {
        where: { season: { isActive: true } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          season: { select: { id: true, name: true } }
        }
      },
      clubXpTransactions: { orderBy: { createdAt: 'desc' }, take: 30 },
      achievements: { orderBy: { unlockedAt: 'desc' }, include: { achievement: true } },
      registrations: {
        where: { tournament: { status: { in: ['UPCOMING', 'ACTIVE'] } }, status: { not: 'CANCELLED' } },
        orderBy: { tournament: { startsAt: 'asc' } },
        include: { tournament: true }
      },
      referralsSent: {
        orderBy: { createdAt: 'desc' },
        include: { invitedUser: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } } }
      }
    }
  });
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  const [rank, loyaltyStats, gamesPlayed, bestResult, achievementDefinitions] = await Promise.all([
    prisma.user.count({ where: { points: { gt: user.points } } }),
    getPlayerLoyaltyStats(user.id),
    prisma.tournamentResult.count({ where: { userId: user.id } }),
    prisma.tournamentResult.aggregate({ where: { userId: user.id }, _min: { place: true } }),
    prisma.achievement.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] })
  ]);
  const unlockedAchievements = new Map(user.achievements.map((entry) => [entry.achievementId, entry]));
  return res.json({
    ...user,
    telegramId: user.telegramId?.toString() ?? null,
    phoneNumber: undefined,
    hasPhoneNumber: Boolean(user.phoneNumber),
    phoneNumberMasked: user.phoneNumber ? `${user.phoneNumber.slice(0, 4)}••••${user.phoneNumber.slice(-2)}` : null,
    rank: rank + 1,
    achievementCatalog: achievementDefinitions.map((achievement) => {
      const unlocked = unlockedAchievements.get(achievement.id);
      const progress = achievementProgressValue(achievement.rule, loyaltyStats);
      return {
        id: achievement.id,
        key: achievement.key,
        title: achievement.title,
        description: achievement.description,
        icon: achievement.icon,
        rule: achievement.rule,
        threshold: achievement.threshold,
        xpReward: achievement.xpReward,
        progress: Math.min(progress, achievement.threshold),
        isUnlocked: Boolean(unlocked),
        isSecret: achievement.key.startsWith('secret_'),
        unlockedAt: unlocked?.unlockedAt ?? null,
        xpAwarded: unlocked?.xpAwarded ?? null
      };
    }),
    stats: {
      gamesPlayed,
      wins: loyaltyStats.wins,
      finalTables: loyaltyStats.finalTables,
      finalTableRate: gamesPlayed ? Math.round(loyaltyStats.finalTables / gamesPlayed * 100) : 0,
      bestPlace: bestResult._min.place,
      currentStreak: loyaltyStats.streak.current,
      bestStreak: loyaltyStats.streak.best
    }
  });
});

const profileUpdateSchema = z.object({
  nickname: z.string()
    .trim()
    .min(2, 'Никнейм должен содержать минимум 2 символа')
    .max(24, 'Никнейм не может быть длиннее 24 символов')
    .regex(/^[\p{L}\p{N}._ -]+$/u, 'Используйте буквы, цифры, пробел, точку, дефис или подчёркивание')
    .nullable()
    .optional(),
  photoData: z.string().max(500_000).nullable().optional()
}).refine((value) => value.nickname !== undefined || value.photoData !== undefined, {
  message: 'Нет изменений для сохранения'
});

function validateProfilePhoto(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new AppError('Поддерживаются JPG, PNG и WebP', 400, 'INVALID_PROFILE_PHOTO');
  const image = Buffer.from(match[2], 'base64');
  if (image.length > 360_000) throw new AppError('После обработки фотография должна быть не больше 350 КБ', 400, 'PROFILE_PHOTO_TOO_LARGE');
  const isJpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const isPng = image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new AppError('Фотография повреждена или имеет неверный формат', 400, 'INVALID_PROFILE_PHOTO');
  return value;
}

publicRouter.patch('/profile', async (req, res, next) => {
  try {
    const input = profileUpdateSchema.parse(req.body);
    const nickname = input.nickname === '' ? null : input.nickname;
    if (nickname) {
      const duplicate = await prisma.user.findFirst({
        where: { id: { not: req.auth!.userId }, nickname: { equals: nickname, mode: 'insensitive' } },
        select: { id: true }
      });
      if (duplicate) throw new AppError('Этот никнейм уже занят', 409, 'NICKNAME_TAKEN');
    }
    const before = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, nickname: true, photoUrl: true, profilePhotoData: true, profilePhotoPublicId: true }
    });
    if (!before) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');
    const data: Prisma.UserUpdateInput = {};
    if (input.nickname !== undefined) data.nickname = nickname;
    let uploadedPhoto: { url: string; publicId: string } | null = null;
    if (input.photoData !== undefined) {
      if (input.photoData === null) {
        data.profilePhotoData = null;
        data.profilePhotoPublicId = null;
        data.photoUrl = null;
      } else {
        const validatedPhoto = validateProfilePhoto(input.photoData);
        try {
          uploadedPhoto = await uploadProfilePhoto(before.id, validatedPhoto);
          data.profilePhotoData = null;
          data.profilePhotoPublicId = uploadedPhoto.publicId;
          data.photoUrl = uploadedPhoto.url;
        } catch (cause) {
          if (!(cause instanceof AppError) || !['CLOUDINARY_NOT_CONFIGURED', 'PROFILE_PHOTO_UPLOAD_FAILED'].includes(cause.code)) throw cause;
          console.warn(`Profile photo for ${before.id} stored in database fallback: ${cause.code}`);
          data.profilePhotoData = validatedPhoto;
          data.profilePhotoPublicId = null;
          data.photoUrl = `/users/${before.id}/avatar?v=${Date.now()}`;
        }
      }
    }
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: req.auth!.userId },
        data,
        select: { id: true, telegramId: true, email: true, username: true, nickname: true, firstName: true, lastName: true, photoUrl: true, role: true, points: true, clubXp: true }
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: 'PROFILE_UPDATED',
        entityType: 'User',
        entityId: user.id,
        summary: 'Игрок обновил профиль',
        before: { nickname: before.nickname, hasCustomPhoto: Boolean(before.photoUrl) },
        after: { nickname: user.nickname, hasCustomPhoto: Boolean(user.photoUrl) }
      });
      return user;
    });
    if (input.photoData === null) await deleteProfilePhoto(before.profilePhotoPublicId);
    return res.json({ ...updated, telegramId: updated.telegramId?.toString() ?? null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return next(new AppError('Этот никнейм уже занят', 409, 'NICKNAME_TAKEN'));
    }
    return next(error);
  }
});
