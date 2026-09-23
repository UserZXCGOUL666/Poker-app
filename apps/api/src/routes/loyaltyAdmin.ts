import { ClubXpSource, ReferralStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from '../services/audit.js';
import { applyManualClubXp, clubDayKey } from '../services/loyalty.js';

export const loyaltyAdminRouter = Router();

loyaltyAdminRouter.get('/', async (_req, res) => {
  const dayKey = clubDayKey();
  const [settings, tips, hands, achievements, recentTransactions, recentReferrals, players, xp, pendingReferrals, rewardedReferrals, attemptsToday, correctToday, unlocked] = await Promise.all([
    prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } }),
    prisma.pokerTip.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.pokerHand.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }, _count: { select: { attempts: true } } } }),
    prisma.achievement.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], include: { _count: { select: { users: true } } } }),
    prisma.clubXpTransaction.findMany({
      orderBy: { createdAt: 'desc' }, take: 30,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, clubXp: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } }
      }
    }),
    prisma.referral.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } },
        invitedUser: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } }
      }
    }),
    prisma.user.count(),
    prisma.user.aggregate({ _sum: { clubXp: true } }),
    prisma.referral.count({ where: { status: ReferralStatus.PENDING } }),
    prisma.referral.count({ where: { status: ReferralStatus.REWARDED } }),
    prisma.dailyHandAttempt.count({ where: { dayKey } }),
    prisma.dailyHandAttempt.count({ where: { dayKey, isCorrect: true } }),
    prisma.userAchievement.count()
  ]);
  return res.json({
    settings, tips, hands, achievements, recentTransactions, recentReferrals,
    summary: {
      players,
      totalClubXp: xp._sum.clubXp ?? 0,
      pendingReferrals,
      rewardedReferrals,
      attemptsToday,
      correctToday,
      unlockedAchievements: unlocked
    }
  });
});

const settingsSchema = z.object({
  dailyHandXp: z.coerce.number().int().min(0).max(10_000),
  referralInviterXp: z.coerce.number().int().min(0).max(100_000),
  referralInviteeXp: z.coerce.number().int().min(0).max(100_000),
  referralEnabled: z.boolean(),
  dailyHandEnabled: z.boolean(),
  tipsEnabled: z.boolean(),
  streakResetDays: z.coerce.number().int().min(1).max(365)
});

loyaltyAdminRouter.put('/settings', async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const previous = await prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
    const settings = await prisma.$transaction(async (tx) => {
      const updated = await tx.loyaltySettings.update({ where: { id: 'main' }, data });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'LOYALTY_SETTINGS_UPDATED', entityType: 'LoyaltySettings', entityId: 'main',
        summary: 'Обновлены правила программы лояльности', before: previous, after: updated
      });
      return updated;
    });
    return res.json(settings);
  } catch (error) { return next(error); }
});

const tipSchema = z.object({
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(20).max(2000),
  category: z.string().trim().min(2).max(50).default('Стратегия'),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true)
});

loyaltyAdminRouter.post('/tips', async (req, res, next) => {
  try {
    const data = tipSchema.parse(req.body);
    const tip = await prisma.$transaction(async (tx) => {
      const created = await tx.pokerTip.create({ data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'POKER_TIP_CREATED', entityType: 'PokerTip', entityId: created.id, summary: `Создан совет «${created.title}»`, after: created });
      return created;
    });
    return res.status(201).json(tip);
  } catch (error) { return next(error); }
});

loyaltyAdminRouter.patch('/tips/:id', async (req, res, next) => {
  try {
    const data = tipSchema.partial().parse(req.body);
    const previous = await prisma.pokerTip.findUnique({ where: { id: req.params.id } });
    if (!previous) throw new AppError('Совет не найден', 404, 'TIP_NOT_FOUND');
    const tip = await prisma.$transaction(async (tx) => {
      const updated = await tx.pokerTip.update({ where: { id: previous.id }, data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'POKER_TIP_UPDATED', entityType: 'PokerTip', entityId: updated.id, summary: `Обновлён совет «${updated.title}»`, before: previous, after: updated });
      return updated;
    });
    return res.json(tip);
  } catch (error) { return next(error); }
});

const optionSchema = z.object({
  label: z.string().trim().min(2).max(180),
  explanation: z.string().trim().min(10).max(2000),
  isCorrect: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0)
});
const handBaseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scenario: z.string().trim().min(20).max(3000),
  heroCards: z.array(z.string().trim().min(2).max(4)).min(2).max(2),
  boardCards: z.array(z.string().trim().min(2).max(4)).max(5),
  difficulty: z.string().trim().min(2).max(30).default('Начальный'),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
  options: z.array(optionSchema).min(2).max(5)
});
const handSchema = handBaseSchema.superRefine((value, ctx) => {
  if (value.options.filter((option) => option.isCorrect).length !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Должен быть ровно один правильный ответ' });
});
const handPatchSchema = handBaseSchema.partial().superRefine((value, ctx) => {
  if (value.options && value.options.filter((option) => option.isCorrect).length !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Должен быть ровно один правильный ответ' });
});

loyaltyAdminRouter.post('/hands', async (req, res, next) => {
  try {
    const data = handSchema.parse(req.body);
    const { options, ...handData } = data;
    const hand = await prisma.$transaction(async (tx) => {
      const created = await tx.pokerHand.create({ data: { ...handData, options: { create: options } }, include: { options: true } });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'POKER_HAND_CREATED', entityType: 'PokerHand', entityId: created.id, summary: `Создана раздача «${created.title}»`, after: { title: created.title, options: created.options.length } });
      return created;
    });
    return res.status(201).json(hand);
  } catch (error) { return next(error); }
});

loyaltyAdminRouter.patch('/hands/:id', async (req, res, next) => {
  try {
    const data = handPatchSchema.parse(req.body);
    const previous = await prisma.pokerHand.findUnique({ where: { id: req.params.id }, include: { options: true, _count: { select: { attempts: true } } } });
    if (!previous) throw new AppError('Раздача не найдена', 404, 'HAND_NOT_FOUND');
    if (data.options && data.options.filter((option) => option.isCorrect).length !== 1) throw new AppError('Должен быть ровно один правильный ответ', 400, 'INVALID_HAND_OPTIONS');
    if (data.options && previous._count.attempts > 0) throw new AppError('У раздачи уже есть ответы. Можно изменить текст и видимость, но не варианты.', 409, 'HAND_HAS_ATTEMPTS');
    const { options, ...handData } = data;
    const hand = await prisma.$transaction(async (tx) => {
      if (options) {
        await tx.pokerHandOption.deleteMany({ where: { handId: previous.id } });
        await tx.pokerHandOption.createMany({ data: options.map((option) => ({ ...option, handId: previous.id })) });
      }
      const updated = await tx.pokerHand.update({ where: { id: previous.id }, data: handData, include: { options: { orderBy: { sortOrder: 'asc' } }, _count: { select: { attempts: true } } } });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'POKER_HAND_UPDATED', entityType: 'PokerHand', entityId: updated.id, summary: `Обновлена раздача «${updated.title}»`, before: { title: previous.title, isActive: previous.isActive }, after: { title: updated.title, isActive: updated.isActive } });
      return updated;
    });
    return res.json(hand);
  } catch (error) { return next(error); }
});

const achievementSchema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().min(5).max(500).optional(),
  xpReward: z.coerce.number().int().min(0).max(100_000).optional(),
  threshold: z.coerce.number().int().min(1).max(100_000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional()
});

loyaltyAdminRouter.patch('/achievements/:id', async (req, res, next) => {
  try {
    const data = achievementSchema.parse(req.body);
    const previous = await prisma.achievement.findUnique({ where: { id: req.params.id } });
    if (!previous) throw new AppError('Достижение не найдено', 404, 'ACHIEVEMENT_NOT_FOUND');
    const achievement = await prisma.$transaction(async (tx) => {
      const updated = await tx.achievement.update({ where: { id: previous.id }, data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'ACHIEVEMENT_UPDATED', entityType: 'Achievement', entityId: updated.id, summary: `Обновлено достижение «${updated.title}»`, before: previous, after: updated });
      return updated;
    });
    return res.json(achievement);
  } catch (error) { return next(error); }
});

const manualXpSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().int().min(-100_000).max(100_000).refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(300),
  idempotencyKey: z.string().max(100).optional()
});

loyaltyAdminRouter.post('/club-xp', async (req, res, next) => {
  try {
    const data = manualXpSchema.parse(req.body);
    const result = await applyManualClubXp({ ...data, createdById: req.auth!.userId });
    await prisma.$transaction((tx) => writeAudit(tx, {
      actorId: req.auth!.userId, action: 'CLUB_XP_ADJUSTED', entityType: 'User', entityId: data.userId,
      summary: `${data.amount > 0 ? 'Начислено' : 'Списано'} ${Math.abs(data.amount)} Club XP`,
      after: { amount: data.amount, balanceAfter: result.transaction.balanceAfter, reason: data.reason, source: ClubXpSource.ADMIN_ADJUSTMENT }
    }));
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

loyaltyAdminRouter.post('/referrals/:id/reject', async (req, res, next) => {
  try {
    const referral = await prisma.referral.findUnique({ where: { id: req.params.id } });
    if (!referral) throw new AppError('Приглашение не найдено', 404, 'REFERRAL_NOT_FOUND');
    if (referral.status !== ReferralStatus.PENDING) throw new AppError('Можно отклонить только ожидающее приглашение', 409, 'REFERRAL_NOT_PENDING');
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.referral.update({ where: { id: referral.id }, data: { status: ReferralStatus.REJECTED, rejectedAt: new Date() } });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'REFERRAL_REJECTED', entityType: 'Referral', entityId: referral.id, summary: 'Реферальное приглашение отклонено администратором', before: { status: referral.status }, after: { status: value.status } });
      return value;
    });
    return res.json(updated);
  } catch (error) { return next(error); }
});
