import crypto from 'node:crypto';
import { AchievementRule, ClubXpSource, Prisma, ReferralStatus, TournamentRegistrationStatus } from '@prisma/client';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';

const attendedStatuses = [TournamentRegistrationStatus.CHECKED_IN, TournamentRegistrationStatus.PLAYED];

export function clubDayKey(date = new Date(), timeZone = env.CLUB_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function nextClubDayStart(date = new Date(), timeZone = env.CLUB_TIMEZONE) {
  const currentDay = clubDayKey(date, timeZone);
  let low = date.getTime();
  let high = low + 30 * 60 * 60 * 1000;
  while (clubDayKey(new Date(high), timeZone) === currentDay) high += 12 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (clubDayKey(new Date(middle), timeZone) === currentDay) low = middle;
    else high = middle;
  }
  return new Date(high);
}

export function dailyIndex(dayKey: string, count: number, salt = '') {
  if (count <= 0) return -1;
  const digest = crypto.createHash('sha256').update(`${salt}:${dayKey}`).digest();
  return digest.readUInt32BE(0) % count;
}

export function calculateVisitStreak(dates: Date[], resetDays: number) {
  const unique = [...new Set(dates.map((date) => date.toISOString().slice(0, 10)))].map((value) => new Date(`${value}T12:00:00.000Z`));
  unique.sort((left, right) => left.getTime() - right.getTime());
  if (!unique.length) return { current: 0, best: 0 };
  let current = 1;
  let best = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const gap = (unique[index].getTime() - unique[index - 1].getTime()) / 86_400_000;
    current = gap <= resetDays ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return { current, best };
}

type XpInput = {
  userId: string;
  amount: number;
  source: ClubXpSource;
  reason: string;
  idempotencyKey: string;
  createdById?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function applyClubXpInTransaction(tx: Prisma.TransactionClient, input: XpInput) {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new AppError('Укажите ненулевое целое количество Club XP', 400, 'INVALID_CLUB_XP');
  const duplicate = await tx.clubXpTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (duplicate) return { transaction: duplicate, duplicate: true };
  const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, clubXp: true } });
  if (!user) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');
  if (user.clubXp + input.amount < 0) throw new AppError('Баланс Club XP не может быть отрицательным', 409, 'NEGATIVE_CLUB_XP');
  const updated = await tx.user.update({ where: { id: user.id }, data: { clubXp: { increment: input.amount } }, select: { clubXp: true } });
  const transaction = await tx.clubXpTransaction.create({
    data: {
      userId: input.userId,
      createdById: input.createdById ?? null,
      source: input.source,
      amount: input.amount,
      balanceAfter: updated.clubXp,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata
    }
  });
  return { transaction, duplicate: false };
}

export async function applyManualClubXp(input: Omit<XpInput, 'source' | 'idempotencyKey'> & { idempotencyKey?: string }) {
  return withSerializableRetry((tx) => applyClubXpInTransaction(tx, {
    ...input,
    source: ClubXpSource.ADMIN_ADJUSTMENT,
    idempotencyKey: input.idempotencyKey ?? `admin-xp:${crypto.randomUUID()}`
  }));
}

export async function ensureReferralCode(userId: string) {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (!existing) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');
  if (existing.referralCode) return existing.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode } });
      return referralCode;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }
  }
  throw new AppError('Не удалось создать реферальный код', 409, 'REFERRAL_CODE_CONFLICT');
}

export async function createReferralForNewUser(invitedUserId: string, rawCode: string | undefined) {
  const code = rawCode?.trim().replace(/^ref[_-]?/i, '').toUpperCase();
  if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) return null;
  const settings = await prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
  if (!settings.referralEnabled) return null;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, firstName: true } });
  if (!referrer || referrer.id === invitedUserId) return null;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.referral.findUnique({ where: { invitedUserId } });
    if (existing) return existing;
    const referral = await tx.referral.create({ data: { referrerId: referrer.id, invitedUserId } });
    await writeAudit(tx, {
      actorId: invitedUserId,
      action: 'REFERRAL_CREATED',
      entityType: 'Referral',
      entityId: referral.id,
      summary: 'Зафиксировано приглашение нового игрока',
      metadata: { referrerId: referrer.id, invitedUserId }
    });
    return referral;
  });
}

export async function qualifyReferralInTransaction(tx: Prisma.TransactionClient, invitedUserId: string, actorId: string) {
  const referral = await tx.referral.findFirst({ where: { invitedUserId, status: ReferralStatus.PENDING } });
  if (!referral) return null;
  const settings = await tx.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
  if (!settings.referralEnabled) return null;
  const now = new Date();
  const claimed = await tx.referral.updateMany({
    where: { id: referral.id, status: ReferralStatus.PENDING },
    data: {
      status: ReferralStatus.REWARDED,
      qualifiedAt: now,
      rewardedAt: now,
      inviterXp: settings.referralInviterXp,
      inviteeXp: settings.referralInviteeXp
    }
  });
  if (claimed.count !== 1) return null;
  if (settings.referralInviterXp > 0) await applyClubXpInTransaction(tx, {
    userId: referral.referrerId,
    amount: settings.referralInviterXp,
    source: ClubXpSource.REFERRAL_INVITER,
    reason: 'Друг впервые посетил турнир',
    idempotencyKey: `referral:${referral.id}:inviter`,
    metadata: { referralId: referral.id, invitedUserId }
  });
  if (settings.referralInviteeXp > 0) await applyClubXpInTransaction(tx, {
    userId: referral.invitedUserId,
    amount: settings.referralInviteeXp,
    source: ClubXpSource.REFERRAL_INVITEE,
    reason: 'Первое посещение клуба по приглашению',
    idempotencyKey: `referral:${referral.id}:invitee`,
    metadata: { referralId: referral.id, referrerId: referral.referrerId }
  });
  await writeAudit(tx, {
    actorId,
    action: 'REFERRAL_REWARDED',
    entityType: 'Referral',
    entityId: referral.id,
    summary: 'Реферальная награда подтверждена первым посещением',
    after: { status: ReferralStatus.REWARDED, inviterXp: settings.referralInviterXp, inviteeXp: settings.referralInviteeXp },
    metadata: { referrerId: referral.referrerId, invitedUserId }
  });
  return { ...referral, status: ReferralStatus.REWARDED, inviterXp: settings.referralInviterXp, inviteeXp: settings.referralInviteeXp };
}

async function loyaltyStats(tx: Prisma.TransactionClient, userId: string, resetDays: number) {
  const [visits, wins, finalTables, referrals, dailyCorrect] = await Promise.all([
    tx.tournamentRegistration.findMany({
      where: { userId, status: { in: attendedStatuses } },
      orderBy: { tournament: { startsAt: 'asc' } },
      select: { checkedInAt: true, tournament: { select: { startsAt: true } } }
    }),
    tx.tournamentResult.count({ where: { userId, place: 1 } }),
    tx.tournamentResult.count({ where: { userId, isFinalTable: true } }),
    tx.referral.count({ where: { referrerId: userId, status: ReferralStatus.REWARDED } }),
    tx.dailyHandAttempt.count({ where: { userId, isCorrect: true } })
  ]);
  const streak = calculateVisitStreak(visits.map((item) => item.checkedInAt ?? item.tournament.startsAt), resetDays);
  return { visits: visits.length, wins, finalTables, referrals, dailyCorrect, streak };
}

export async function getPlayerLoyaltyStats(userId: string) {
  const settings = await prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
  return prisma.$transaction((tx) => loyaltyStats(tx, userId, settings.streakResetDays));
}

export type AchievementProgressStats = {
  visits: number;
  wins: number;
  finalTables: number;
  referrals: number;
  dailyCorrect: number;
  streak: { current: number; best: number };
};

export function achievementProgressValue(rule: AchievementRule, stats: AchievementProgressStats) {
  const values: Record<AchievementRule, number> = {
    FIRST_VISIT: stats.visits,
    FIRST_WIN: stats.wins,
    VISITS: stats.visits,
    FINAL_TABLES: stats.finalTables,
    REFERRALS: stats.referrals,
    STREAK: stats.streak.best,
    DAILY_HAND_CORRECT: stats.dailyCorrect
  };
  return values[rule];
}

export async function evaluateAchievements(userId: string) {
  return withSerializableRetry(async (tx) => {
    const settings = await tx.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
    const [definitions, unlocked, stats] = await Promise.all([
      tx.achievement.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
      tx.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
      loyaltyStats(tx, userId, settings.streakResetDays)
    ]);
    const known = new Set(unlocked.map((item) => item.achievementId));
    const awarded = [];
    for (const achievement of definitions) {
      if (known.has(achievement.id) || achievementProgressValue(achievement.rule, stats) < achievement.threshold) continue;
      const unlockedAchievement = await tx.userAchievement.create({ data: { userId, achievementId: achievement.id, xpAwarded: achievement.xpReward } });
      if (achievement.xpReward > 0) await applyClubXpInTransaction(tx, {
        userId,
        amount: achievement.xpReward,
        source: ClubXpSource.ACHIEVEMENT,
        reason: `Достижение: ${achievement.title}`,
        idempotencyKey: `achievement:${userId}:${achievement.id}`,
        metadata: { achievementId: achievement.id, key: achievement.key }
      });
      await writeAudit(tx, {
        actorId: userId,
        action: 'ACHIEVEMENT_UNLOCKED',
        entityType: 'Achievement',
        entityId: achievement.id,
        summary: `Открыто достижение «${achievement.title}»`,
        after: { xpAwarded: achievement.xpReward, threshold: achievement.threshold }
      });
      awarded.push({ ...unlockedAchievement, achievement });
    }
    return { awarded, stats };
  });
}

export async function getDailyContent(userId: string, date = new Date(), options: { excludeTipId?: string } = {}) {
  const dayKey = clubDayKey(date);
  const settings = await prisma.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
  const [tips, hands, attempt, user] = await Promise.all([
    settings.tipsEnabled ? prisma.pokerTip.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }) : [],
    settings.dailyHandEnabled ? prisma.pokerHand.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } }) : [],
    prisma.dailyHandAttempt.findUnique({ where: { userId_dayKey: { userId, dayKey } }, include: { selectedOption: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { clubXp: true } })
  ]);
  const availableTips = options.excludeTipId && tips.length > 1
    ? tips.filter((tip) => tip.id !== options.excludeTipId)
    : tips;
  const tip = availableTips.length ? availableTips[crypto.randomInt(availableTips.length)] : null;
  const selectedHand = attempt
    ? hands.find((hand) => hand.id === attempt.handId) ?? await prisma.pokerHand.findUnique({ where: { id: attempt.handId }, include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } })
    : hands[dailyIndex(dayKey, hands.length, 'hand')] ?? null;
  const correctOption = attempt && selectedHand ? selectedHand.options.find((option) => option.isCorrect) ?? null : null;
  return {
    dayKey,
    nextDayAt: nextClubDayStart(date).toISOString(),
    timeZone: env.CLUB_TIMEZONE,
    clubXp: user?.clubXp ?? 0,
    tip: tip ? { id: tip.id, title: tip.title, body: tip.body, category: tip.category } : null,
    hand: selectedHand ? {
      id: selectedHand.id,
      title: selectedHand.title,
      scenario: selectedHand.scenario,
      heroCards: selectedHand.heroCards,
      boardCards: selectedHand.boardCards,
      difficulty: selectedHand.difficulty,
      rewardXp: settings.dailyHandXp,
      options: selectedHand.options.map((option) => ({
        id: option.id,
        label: option.label,
        explanation: attempt ? option.explanation : undefined
      })),
      attempt: attempt ? {
        selectedOptionId: attempt.selectedOptionId,
        correctOptionId: correctOption?.id ?? null,
        isCorrect: attempt.isCorrect,
        awardedXp: attempt.awardedXp,
        attemptedAt: attempt.attemptedAt
      } : null
    } : null
  };
}

export async function answerDailyHand(userId: string, optionId: string) {
  const content = await getDailyContent(userId);
  if (!content.hand) throw new AppError('Раздача дня временно недоступна', 404, 'DAILY_HAND_UNAVAILABLE');
  const result = await withSerializableRetry(async (tx) => {
    const duplicate = await tx.dailyHandAttempt.findUnique({ where: { userId_dayKey: { userId, dayKey: content.dayKey } } });
    if (duplicate) return { duplicate: true };
    const option = await tx.pokerHandOption.findFirst({ where: { id: optionId, handId: content.hand!.id } });
    if (!option) throw new AppError('Вариант ответа не найден', 400, 'INVALID_DAILY_HAND_OPTION');
    const settings = await tx.loyaltySettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main' } });
    const awardedXp = option.isCorrect && settings.dailyHandEnabled ? settings.dailyHandXp : 0;
    const attempt = await tx.dailyHandAttempt.create({ data: {
      userId, handId: content.hand!.id, selectedOptionId: option.id, dayKey: content.dayKey, isCorrect: option.isCorrect, awardedXp
    } });
    if (awardedXp > 0) await applyClubXpInTransaction(tx, {
      userId,
      amount: awardedXp,
      source: ClubXpSource.DAILY_HAND,
      reason: 'Правильный ответ в раздаче дня',
      idempotencyKey: `daily-hand:${userId}:${content.dayKey}`,
      metadata: { handId: content.hand!.id, optionId: option.id, dayKey: content.dayKey }
    });
    await tx.analyticsEvent.create({ data: {
      userId,
      type: 'DAILY_HAND_ANSWERED',
      idempotencyKey: `daily-hand-answer:${userId}:${content.dayKey}`,
      metadata: { handId: content.hand!.id, isCorrect: option.isCorrect, awardedXp }
    } });
    return { duplicate: false, attempt };
  });
  if (!result.duplicate) await evaluateAchievements(userId);
  return getDailyContent(userId);
}

export async function recordDailyAppOpen(userId: string) {
  const dayKey = clubDayKey();
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  await prisma.analyticsEvent.upsert({
    where: { idempotencyKey: `app-open:${userId}:${dayKey}` },
    update: {},
    create: { userId, type: 'APP_OPENED', idempotencyKey: `app-open:${userId}:${dayKey}` }
  });
}

async function withSerializableRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code);
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new AppError('Не удалось обновить Club XP. Повторите попытку.', 409, 'CLUB_XP_CONFLICT');
}
