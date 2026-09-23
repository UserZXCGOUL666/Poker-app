import crypto from 'node:crypto';
import { Router } from 'express';
import { ClubXpSource, ReasonPresetKind, TournamentPlayerActionType, TournamentRegistrationStatus, TournamentStatus } from '@prisma/client';
import { z } from 'zod';
import { notifyAboutTournament, notifyUser, pointsNotification, registrationNotification } from '../bot.js';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { browserInviteExpiresAt, createBrowserInviteToken, hashBrowserInviteToken } from '../services/browserAccess.js';
import { applyManualPointChange } from '../services/points.js';
import { shouldResetSeasonBalances } from '../services/seasons.js';
import { participantsFitCapacity } from '../services/tournaments.js';
import { writeAudit } from '../services/audit.js';
import { applyBulkPointChanges, reversePointTransaction } from '../services/pointOperations.js';
import { registerForTournament, shouldNotifyRegistrationStatusChange, updateRegistrationStatus } from '../services/registrations.js';
import { generateRecurringTournaments } from '../services/recurringTournaments.js';
import { finalizeSeason } from '../services/seasonsFinalization.js';
import { applyClubXpInTransaction } from '../services/loyalty.js';
import { assignPlayerSeat, autoSeatTournament, closeTournamentTable, createTournamentTable, getTournamentSeating, unseatPlayer, updateTournamentTableCapacity } from '../services/seating.js';
import { loyaltyAdminRouter } from './loyaltyAdmin.js';
import { analyticsAdminRouter } from './analyticsAdmin.js';
import { timerAdminRouter } from './timerAdmin.js';
import { appendTrainingLeadToSheet, extractGoogleSpreadsheetId, googleSheetsConfigured } from '../services/googleSheets.js';

export const adminRouter = Router();

function serializeTelegramId(value: bigint | null) {
  return value?.toString() ?? null;
}
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use('/loyalty', loyaltyAdminRouter);
adminRouter.use('/analytics', analyticsAdminRouter);
adminRouter.use('/tournaments', timerAdminRouter);

adminRouter.get('/overview', async (_req, res) => {
  const now = new Date();
  const reminderHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const sessionHorizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const operationsLookback = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [players, tournaments, activeSeason, activeBrowserSessions, nextTournament, recentTournaments, recentPointTransactions, unnotifiedTournament, unfinishedTournament, expiringSessions, waitlistedPlayers, capacityCandidates, operationsCandidates] = await Promise.all([
    prisma.user.count(),
    prisma.tournament.count(),
    prisma.season.findFirst({ where: { isActive: true } }),
    prisma.browserSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prisma.tournament.findFirst({ where: { status: 'UPCOMING', startsAt: { gte: now } }, orderBy: { startsAt: 'asc' } }),
    prisma.tournament.findMany({
      orderBy: { startsAt: 'desc' }, take: 6,
      include: { season: { select: { name: true } }, _count: { select: { results: true, notifications: true, registrations: true } } }
    }),
    prisma.pointTransaction.findMany({
      orderBy: { createdAt: 'desc' }, take: 6,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        reversedBy: { select: { id: true } }
      }
    }),
    prisma.tournament.findFirst({
      where: { status: 'UPCOMING', startsAt: { gte: now, lte: reminderHorizon }, notifications: { none: {} } },
      orderBy: { startsAt: 'asc' }
    }),
    prisma.tournament.findFirst({
      where: { status: 'FINISHED', startsAt: { gte: operationsLookback }, results: { none: {} } },
      orderBy: { startsAt: 'desc' }
    }),
    prisma.browserSession.count({ where: { revokedAt: null, expiresAt: { gt: now, lte: sessionHorizon } } }),
    prisma.tournamentRegistration.count({ where: { status: TournamentRegistrationStatus.WAITLISTED, tournament: { status: 'UPCOMING' } } }),
    prisma.tournament.findMany({ where: { status: { in: ['UPCOMING', 'ACTIVE'] }, participantCount: { gt: 0 } }, take: 100 }),
    prisma.tournament.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'UPCOMING' },
          { status: 'FINISHED', startsAt: { gte: operationsLookback }, OR: [{ results: { none: {} } }, { pointBatches: { none: {} } }] }
        ]
      },
      orderBy: { startsAt: 'desc' }, take: 50,
      select: { id: true, status: true, startsAt: true }
    })
  ]);
  const focusCandidate = operationsCandidates.find((item) => item.status === 'ACTIVE')
    ?? operationsCandidates.find((item) => item.status === 'UPCOMING' && item.startsAt < now)
    ?? operationsCandidates.find((item) => item.status === 'FINISHED')
    ?? [...operationsCandidates].reverse().find((item) => item.status === 'UPCOMING')
    ?? null;
  const focus = focusCandidate ? await prisma.tournament.findUnique({
    where: { id: focusCandidate.id },
    select: {
      id: true, title: true, startsAt: true, location: true, capacity: true, participantCount: true, status: true,
      registrationClosed: true, seatingPublishedAt: true, seatingVersion: true,
      season: { select: { name: true } },
      _count: { select: { results: true, notifications: true, tables: true, seats: true, pointBatches: true } },
      registrations: { select: { status: true } }
    }
  }) : null;
  const focusTournament = focus ? {
    ...focus,
    registrationCounts: focus.registrations.reduce((counts, registration) => {
      const key = registration.status.toLowerCase() as keyof typeof counts;
      counts[key] += 1;
      return counts;
    }, { registered: 0, waitlisted: 0, checked_in: 0, played: 0, cancelled: 0 }),
    registrations: undefined
  } : null;
  const overCapacity = capacityCandidates.find((item) => item.participantCount > item.capacity);
  const alerts = [
    !activeSeason ? { id: 'no-active-season', severity: 'critical', title: 'Нет активного сезона', text: 'Начисление очков заблокировано до активации сезона.', section: 'settings' } : null,
    unnotifiedTournament ? { id: `unnotified-${unnotifiedTournament.id}`, severity: 'warning', title: 'Турнир скоро', text: `Для «${unnotifiedTournament.title}» ещё не отправлено уведомление.`, section: 'tournaments', targetId: unnotifiedTournament.id } : null,
    unfinishedTournament ? { id: `results-${unfinishedTournament.id}`, severity: 'warning', title: 'Нет результатов', text: `Заполните результаты турнира «${unfinishedTournament.title}».`, section: 'tournaments', targetId: unfinishedTournament.id } : null,
    overCapacity ? { id: `capacity-${overCapacity.id}`, severity: 'critical', title: 'Превышена вместимость', text: `В «${overCapacity.title}» участников больше установленного лимита.`, section: 'tournaments', targetId: overCapacity.id } : null,
    expiringSessions ? { id: 'expiring-sessions', severity: 'info', title: 'Истекают браузерные сессии', text: `${expiringSessions} сессий завершатся в течение трёх дней.`, section: 'access' } : null,
    waitlistedPlayers ? { id: 'waitlisted-players', severity: 'info', title: 'Есть лист ожидания', text: `${waitlistedPlayers} игроков ожидают место в предстоящих турнирах.`, section: 'tournaments' } : null
  ].filter(Boolean);
  return res.json({ players, tournaments, activeSeason, activeBrowserSessions, nextTournament, focusTournament, recentTournaments, recentPointTransactions, alerts });
});

adminRouter.get('/training-leads/settings', async (_req, res) => {
  const [settings, total, unsynced] = await Promise.all([
    prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { trainingSheetUrl: true, trainingLeadPopupEnabled: true, updatedAt: true } }),
    prisma.trainingLead.count(),
    prisma.trainingLead.count({ where: { sheetSyncedAt: null } })
  ]);
  return res.json({
    trainingSheetUrl: settings?.trainingSheetUrl ?? '',
    trainingLeadPopupEnabled: settings?.trainingLeadPopupEnabled ?? false,
    googleSheetsConfigured: googleSheetsConfigured(),
    googleServiceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    totalLeads: total,
    unsyncedLeads: unsynced,
    updatedAt: settings?.updatedAt ?? null
  });
});

const trainingLeadSettingsSchema = z.object({
  trainingSheetUrl: z.string().trim().max(1000).optional().default(''),
  trainingLeadPopupEnabled: z.boolean().default(false)
}).superRefine((value, ctx) => {
  if (value.trainingSheetUrl && !extractGoogleSpreadsheetId(value.trainingSheetUrl)) {
    ctx.addIssue({ code: 'custom', path: ['trainingSheetUrl'], message: 'Вставьте ссылку на Google Sheets вида docs.google.com/spreadsheets/d/…' });
  }
  if (value.trainingLeadPopupEnabled && !value.trainingSheetUrl) {
    ctx.addIssue({ code: 'custom', path: ['trainingSheetUrl'], message: 'Для включения формы укажите таблицу Google Sheets' });
  }
});

adminRouter.put('/training-leads/settings', async (req, res, next) => {
  try {
    const input = trainingLeadSettingsSchema.parse(req.body);
    const trainingSheetUrl = input.trainingSheetUrl || null;
    const settings = await prisma.$transaction(async (tx) => {
      const existing = await tx.clubSettings.findUnique({ where: { id: 'main' }, select: { trainingSheetUrl: true, trainingLeadPopupEnabled: true } });
      const updated = await tx.clubSettings.upsert({
        where: { id: 'main' },
        update: { trainingSheetUrl, trainingLeadPopupEnabled: input.trainingLeadPopupEnabled },
        create: { id: 'main', trainingSheetUrl, trainingLeadPopupEnabled: input.trainingLeadPopupEnabled }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId,
        action: 'TRAINING_LEAD_SETTINGS_UPDATED',
        entityType: 'ClubSettings',
        entityId: updated.id,
        summary: input.trainingLeadPopupEnabled ? 'Включена запись на бесплатное обучение' : 'Обновлены настройки записи на обучение',
        before: existing ?? undefined,
        after: { trainingSheetUrl, trainingLeadPopupEnabled: input.trainingLeadPopupEnabled }
      });
      return updated;
    });
    return res.json({
      trainingSheetUrl: settings.trainingSheetUrl ?? '',
      trainingLeadPopupEnabled: settings.trainingLeadPopupEnabled,
      googleSheetsConfigured: googleSheetsConfigured(),
      googleServiceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
      updatedAt: settings.updatedAt
    });
  } catch (error) { return next(error); }
});

adminRouter.post('/training-leads/sync', async (_req, res, next) => {
  try {
    const settings = await prisma.clubSettings.findUnique({ where: { id: 'main' }, select: { trainingSheetUrl: true } });
    if (!settings?.trainingSheetUrl) throw new AppError('Сначала укажите Google Sheets в настройках', 409, 'TRAINING_SHEET_NOT_SET');
    if (!googleSheetsConfigured()) throw new AppError('Google Sheets service account не настроен на сервере', 409, 'GOOGLE_SHEETS_NOT_CONFIGURED');
    const leads = await prisma.trainingLead.findMany({
      where: { sheetSyncedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } } }
    });
    let synced = 0;
    let failed = 0;
    for (const lead of leads) {
      const userLabel = lead.user.username ? `@${lead.user.username}` : lead.user.nickname || [lead.user.firstName, lead.user.lastName].filter(Boolean).join(' ');
      try {
        await appendTrainingLeadToSheet({
          sheetUrl: settings.trainingSheetUrl,
          createdAt: lead.createdAt,
          fullName: lead.fullName,
          phoneNumber: lead.phoneNumber,
          preferredContactAt: lead.preferredContactAt,
          preferredVisitAt: lead.preferredVisitAt,
          userLabel,
          userId: lead.userId
        });
        await prisma.trainingLead.update({ where: { id: lead.id }, data: { sheetSyncedAt: new Date(), sheetSyncError: null } });
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Неизвестная ошибка Google Sheets';
        await prisma.trainingLead.update({ where: { id: lead.id }, data: { sheetSyncError: message } });
        failed += 1;
      }
    }
    return res.json({ synced, failed, remaining: await prisma.trainingLead.count({ where: { sheetSyncedAt: null } }) });
  } catch (error) { return next(error); }
});

adminRouter.get('/branding', async (_req, res) => {
  const settings = await prisma.clubSettings.findUnique({ where: { id: 'main' } });
  return res.json({ ratingBannerImageData: settings?.ratingBannerImageData ?? null, accentColor: settings?.accentColor ?? '#3B8CFF', updatedAt: settings?.updatedAt ?? null });
});

const accentColorSchema = z.object({ accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Укажите цвет в формате #RRGGBB') });

adminRouter.put('/branding/accent-color', async (req, res, next) => {
  try {
    const { accentColor: rawAccentColor } = accentColorSchema.parse(req.body);
    const accentColor = rawAccentColor.toUpperCase();
    const settings = await prisma.$transaction(async (tx) => {
      const existing = await tx.clubSettings.findUnique({ where: { id: 'main' } });
      const updated = await tx.clubSettings.upsert({
        where: { id: 'main' },
        update: { accentColor },
        create: { id: 'main', accentColor }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'INTERFACE_COLOR_UPDATED', entityType: 'ClubSettings', entityId: updated.id,
        summary: `Цвет интерфейса изменён на ${accentColor}`,
        before: { accentColor: existing?.accentColor ?? '#3B8CFF' }, after: { accentColor }
      });
      return updated;
    });
    return res.json({ ratingBannerImageData: settings.ratingBannerImageData, accentColor: settings.accentColor, updatedAt: settings.updatedAt });
  } catch (error) { return next(error); }
});

const ratingBannerSchema = z.object({
  imageData: z.string().max(900_000).refine(
    (value) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
    'Разрешены только JPEG, PNG или WebP'
  )
});

adminRouter.put('/branding/rating-banner', async (req, res, next) => {
  try {
    const { imageData } = ratingBannerSchema.parse(req.body);
    const settings = await prisma.$transaction(async (tx) => {
      const existing = await tx.clubSettings.findUnique({ where: { id: 'main' } });
      const updated = await tx.clubSettings.upsert({
        where: { id: 'main' },
        update: { ratingBannerImageData: imageData },
        create: { id: 'main', ratingBannerImageData: imageData }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'RATING_BANNER_UPDATED', entityType: 'ClubSettings', entityId: updated.id,
        summary: 'Обновлено изображение рейтинговой карточки',
        before: { hadImage: Boolean(existing?.ratingBannerImageData) }, after: { hadImage: true, bytes: imageData.length }
      });
      return updated;
    });
    return res.json({ ratingBannerImageData: settings.ratingBannerImageData, accentColor: settings.accentColor, updatedAt: settings.updatedAt });
  } catch (error) { return next(error); }
});

adminRouter.delete('/branding/rating-banner', async (req, res, next) => {
  try {
    const settings = await prisma.$transaction(async (tx) => {
      const existing = await tx.clubSettings.findUnique({ where: { id: 'main' } });
      const updated = await tx.clubSettings.upsert({
        where: { id: 'main' }, update: { ratingBannerImageData: null }, create: { id: 'main' }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'RATING_BANNER_REMOVED', entityType: 'ClubSettings', entityId: updated.id,
        summary: 'Удалено изображение рейтинговой карточки', before: { hadImage: Boolean(existing?.ratingBannerImageData) }, after: { hadImage: false }
      });
      return updated;
    });
    return res.json({ ratingBannerImageData: null, accentColor: settings.accentColor, updatedAt: settings.updatedAt });
  } catch (error) { return next(error); }
});

adminRouter.get('/users', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const users = await prisma.user.findMany({
    where: search ? {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } }
      ]
    } : undefined,
    orderBy: [{ points: 'desc' }, { firstName: 'asc' }],
    take: 1000,
    select: {
      id: true, telegramId: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true, role: true, points: true, clubXp: true, phoneNumber: true, phoneSharedAt: true,
      tags: { include: { tag: true } },
      results: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, tournament: { select: { startsAt: true } } } },
      _count: { select: { results: true, browserSessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }, registrations: true } }
    }
  });
  return res.json(users.map(({ results, tags, ...user }) => ({
    ...user,
    telegramId: serializeTelegramId(user.telegramId),
    lastPlayedAt: results[0]?.tournament.startsAt ?? null,
    tags: tags.map((item) => item.tag)
  })));
});

adminRouter.get('/users/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      pointTransactions: {
        orderBy: { createdAt: 'desc' }, take: 50,
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          season: { select: { id: true, name: true, isActive: true, finalizedAt: true } },
          reversedBy: { select: { id: true, createdAt: true } },
          reversalOf: { select: { id: true, amount: true, reason: true } },
          batch: { select: { id: true, tournament: { select: { id: true, title: true } } } }
        }
      },
      results: {
        orderBy: { createdAt: 'desc' }, take: 20,
        include: { tournament: { select: { id: true, title: true, startsAt: true, status: true } } }
      },
      browserSessions: { orderBy: { createdAt: 'desc' }, take: 30 },
      tags: { include: { tag: true } }
    }
  });
  if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
  const { profilePhotoData: _profilePhotoData, ...safeUser } = user;
  return res.json({ ...safeUser, telegramId: serializeTelegramId(user.telegramId), tags: user.tags.map((item) => item.tag) });
});

const userNoteSchema = z.object({ note: z.string().max(2000).nullable() });
adminRouter.patch('/users/:id/note', async (req, res, next) => {
  try {
    const { note } = userNoteSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, firstName: true, adminNote: true } });
    if (!existing) return res.status(404).json({ message: 'Пользователь не найден' });
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: existing.id }, data: { adminNote: note?.trim() || null }, select: { id: true, adminNote: true } });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'USER_NOTE_UPDATED', entityType: 'User', entityId: existing.id,
        summary: `Обновлена заметка игрока ${existing.firstName}`,
        before: { adminNote: existing.adminNote }, after: { adminNote: updated.adminNote }
      });
      return updated;
    });
    return res.json(user);
  } catch (error) { return next(error); }
});

const tagSchema = z.object({ name: z.string().trim().min(2).max(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b8cff') });
adminRouter.get('/tags', async (_req, res) => res.json(await prisma.playerTag.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } })));
adminRouter.post('/tags', async (req, res, next) => {
  try {
    const data = tagSchema.parse(req.body);
    const tag = await prisma.$transaction(async (tx) => {
      const created = await tx.playerTag.create({ data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TAG_CREATED', entityType: 'PlayerTag', entityId: created.id, summary: `Создан тег «${created.name}»`, after: { name: created.name, color: created.color } });
      return created;
    });
    return res.status(201).json(tag);
  } catch (error) { return next(error); }
});
adminRouter.patch('/tags/:id', async (req, res, next) => {
  try {
    const patch = tagSchema.partial().parse(req.body);
    const existing = await prisma.playerTag.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Тег не найден' });
    const tag = await prisma.$transaction(async (tx) => {
      const updated = await tx.playerTag.update({ where: { id: existing.id }, data: patch });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TAG_UPDATED', entityType: 'PlayerTag', entityId: existing.id, summary: `Обновлён тег «${existing.name}»`, before: { name: existing.name, color: existing.color }, after: { name: updated.name, color: updated.color } });
      return updated;
    });
    return res.json(tag);
  } catch (error) { return next(error); }
});
adminRouter.delete('/tags/:id', async (req, res, next) => {
  try {
    const existing = await prisma.playerTag.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
    if (!existing) return res.status(404).json({ message: 'Тег не найден' });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TAG_DELETED', entityType: 'PlayerTag', entityId: existing.id, summary: `Удалён тег «${existing.name}»`, before: { name: existing.name, color: existing.color, users: existing._count.users } });
      await tx.playerTag.delete({ where: { id: existing.id } });
    });
    return res.json({ message: 'Тег удалён' });
  } catch (error) { return next(error); }
});
adminRouter.post('/users/:id/tags', async (req, res, next) => {
  try {
    const { tagId } = z.object({ tagId: z.string().min(1) }).parse(req.body);
    const [user, tag] = await Promise.all([prisma.user.findUnique({ where: { id: req.params.id } }), prisma.playerTag.findUnique({ where: { id: tagId } })]);
    if (!user || !tag) return res.status(404).json({ message: 'Пользователь или тег не найден' });
    await prisma.$transaction(async (tx) => {
      await tx.userTag.upsert({ where: { userId_tagId: { userId: user.id, tagId } }, update: {}, create: { userId: user.id, tagId } });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'USER_TAG_ADDED', entityType: 'User', entityId: user.id, summary: `Игроку ${user.firstName} добавлен тег «${tag.name}»`, after: { tagId, tagName: tag.name } });
    });
    return res.status(201).json({ message: 'Тег добавлен' });
  } catch (error) { return next(error); }
});
adminRouter.delete('/users/:id/tags/:tagId', async (req, res, next) => {
  try {
    const [user, tag] = await Promise.all([prisma.user.findUnique({ where: { id: req.params.id } }), prisma.playerTag.findUnique({ where: { id: req.params.tagId } })]);
    if (!user || !tag) return res.status(404).json({ message: 'Пользователь или тег не найден' });
    await prisma.$transaction(async (tx) => {
      await tx.userTag.deleteMany({ where: { userId: user.id, tagId: tag.id } });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'USER_TAG_REMOVED', entityType: 'User', entityId: user.id, summary: `У игрока ${user.firstName} удалён тег «${tag.name}»`, before: { tagId: tag.id, tagName: tag.name } });
    });
    return res.json({ message: 'Тег удалён' });
  } catch (error) { return next(error); }
});

const browserInviteSchema = z.object({ userId: z.string().min(1) });

adminRouter.post('/browser-access/invites', async (req, res, next) => {
  try {
    const { userId } = browserInviteSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, nickname: true }
    });
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

    const token = createBrowserInviteToken();
    const expiresAt = browserInviteExpiresAt();
    await prisma.$transaction(async (tx) => {
      await tx.browserAccessInvite.deleteMany({ where: { userId, usedAt: null } });
      const invite = await tx.browserAccessInvite.create({
        data: {
          tokenHash: hashBrowserInviteToken(token),
          userId,
          createdById: req.auth!.userId,
          expiresAt
        }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'BROWSER_INVITE_CREATED', entityType: 'BrowserAccessInvite', entityId: invite.id,
        summary: `Создан браузерный доступ для ${user.firstName}`, after: { userId, expiresAt: expiresAt.toISOString() }
      });
    });

    const url = new URL('/browser-login', env.MINI_APP_URL);
    url.searchParams.set('token', token);
    return res.status(201).json({
      url: url.toString(),
      expiresAt,
      user: { ...user, telegramId: serializeTelegramId(user.telegramId) }
    });
  } catch (error) { return next(error); }
});

adminRouter.get('/browser-access/sessions', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const sessions = await prisma.browserSession.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, nickname: true } }
    }
  });
  return res.json(sessions.map((session) => ({
    ...session,
    user: { ...session.user, telegramId: serializeTelegramId(session.user.telegramId) }
  })));
});

adminRouter.post('/browser-access/sessions/:id/revoke', async (req, res) => {
  const existing = await prisma.browserSession.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!existing || existing.revokedAt) return res.status(404).json({ message: 'Активная браузерная сессия не найдена' });
  await prisma.$transaction(async (tx) => {
    await tx.browserSession.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { actorId: req.auth!.userId, action: 'BROWSER_SESSION_REVOKED', entityType: 'BrowserSession', entityId: existing.id, summary: `Отозван браузерный доступ ${existing.user.firstName}`, before: { revokedAt: null }, after: { revokedAt: new Date().toISOString() } });
  });
  return res.json({ message: 'Браузерный доступ отозван' });
});

const pointChangeSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().int().min(-100000).max(100000).refine((value) => value !== 0, 'Укажите ненулевое количество очков'),
  reason: z.string().trim().min(3).max(160),
  idempotencyKey: z.string().uuid().optional()
});

adminRouter.post('/points', async (req, res, next) => {
  try {
    const data = pointChangeSchema.parse(req.body);
    const result = await applyManualPointChange({ ...data, adminId: req.auth!.userId });
    const notification = result.duplicate ? null : await notifyUser(result.user.telegramId, pointsNotification(data.amount, result.user.points, data.reason));
    return res.status(result.duplicate ? 200 : 201).json({
      ...result,
      user: { ...result.user, telegramId: serializeTelegramId(result.user.telegramId) },
      transaction: { ...result.transaction, user: { ...result.transaction.user, telegramId: serializeTelegramId(result.transaction.user.telegramId) } },
      notification
    });
  } catch (error) { return next(error); }
});

const bulkPointsSchema = z.object({
  tournamentId: z.string().min(1).optional(),
  idempotencyKey: z.string().uuid(),
  note: z.string().trim().max(160).optional(),
  entries: z.array(z.object({
    userId: z.string().min(1),
    amount: z.coerce.number().int().min(-100000).max(100000).refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(160)
  })).min(1).max(1000)
}).superRefine(({ entries }, ctx) => {
  if (new Set(entries.map((item) => item.userId)).size !== entries.length) ctx.addIssue({ code: 'custom', message: 'Игрок не может встречаться в пакете дважды' });
});

adminRouter.post('/points/bulk', async (req, res, next) => {
  try {
    const data = bulkPointsSchema.parse(req.body);
    const result = await applyBulkPointChanges({ ...data, adminId: req.auth!.userId });
    const notifications = result.duplicate ? [] : await mapWithConcurrency(result.batch.transactions, 8, async (transaction) => ({
      userId: transaction.userId,
      ...(await notifyUser(transaction.user.telegramId, pointsNotification(transaction.amount, transaction.balanceAfter, transaction.reason)))
    }));
    return res.status(result.duplicate ? 200 : 201).json({
      ...result,
      batch: { ...result.batch, transactions: result.batch.transactions.map((transaction) => ({ ...transaction, user: { ...transaction.user, telegramId: serializeTelegramId(transaction.user.telegramId) } })) },
      notifications
    });
  } catch (error) { return next(error); }
});

const reversePointSchema = z.object({ reason: z.string().trim().min(3).max(160), idempotencyKey: z.string().uuid() });
adminRouter.post('/points/:id/reverse', async (req, res, next) => {
  try {
    const data = reversePointSchema.parse(req.body);
    const result = await reversePointTransaction({ ...data, transactionId: req.params.id, adminId: req.auth!.userId });
    const notification = result.duplicate ? null : await notifyUser(result.transaction.user.telegramId, pointsNotification(result.transaction.amount, result.transaction.balanceAfter, result.transaction.reason));
    return res.status(result.duplicate ? 200 : 201).json({
      ...result,
      transaction: { ...result.transaction, user: { ...result.transaction.user, telegramId: serializeTelegramId(result.transaction.user.telegramId) } },
      notification
    });
  } catch (error) { return next(error); }
});

adminRouter.get('/points/history', async (req, res, next) => {
  try {
    const query = z.object({
      userId: z.string().optional(),
      take: z.coerce.number().int().min(1).max(100).default(30)
    }).parse(req.query);
    const history = await prisma.pointTransaction.findMany({
      where: query.userId ? { userId: query.userId } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.take,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, points: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        season: { select: { id: true, name: true, isActive: true, finalizedAt: true } },
        reversedBy: { select: { id: true, createdAt: true } },
        reversalOf: { select: { id: true, amount: true, reason: true } },
        batch: { select: { id: true, tournament: { select: { id: true, title: true } } } }
      }
    });
    return res.json(history);
  } catch (error) { return next(error); }
});

const reasonPresetSchema = z.object({
  label: z.string().trim().min(2).max(30),
  reason: z.string().trim().min(3).max(160),
  kind: z.nativeEnum(ReasonPresetKind).default(ReasonPresetKind.BOTH),
  defaultAmount: z.coerce.number().int().min(-100000).max(100000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true)
});
adminRouter.get('/reason-presets', async (_req, res) => res.json(await prisma.reasonPreset.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })));
adminRouter.post('/reason-presets', async (req, res, next) => {
  try {
    const data = reasonPresetSchema.parse(req.body);
    const preset = await prisma.$transaction(async (tx) => {
      const created = await tx.reasonPreset.create({ data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'REASON_PRESET_CREATED', entityType: 'ReasonPreset', entityId: created.id, summary: `Создан шаблон причины «${created.label}»`, after: { label: created.label, reason: created.reason, kind: created.kind } });
      return created;
    });
    return res.status(201).json(preset);
  } catch (error) { return next(error); }
});
adminRouter.patch('/reason-presets/:id', async (req, res, next) => {
  try {
    const patch = reasonPresetSchema.partial().parse(req.body);
    const existing = await prisma.reasonPreset.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Шаблон причины не найден' });
    const preset = await prisma.$transaction(async (tx) => {
      const updated = await tx.reasonPreset.update({ where: { id: existing.id }, data: patch });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'REASON_PRESET_UPDATED', entityType: 'ReasonPreset', entityId: existing.id, summary: `Обновлён шаблон причины «${existing.label}»`, before: { label: existing.label, reason: existing.reason, kind: existing.kind, isActive: existing.isActive }, after: { label: updated.label, reason: updated.reason, kind: updated.kind, isActive: updated.isActive } });
      return updated;
    });
    return res.json(preset);
  } catch (error) { return next(error); }
});

adminRouter.get('/seasons', async (_req, res) => {
  const seasons = await prisma.season.findMany({ orderBy: { startsAt: 'desc' }, include: { finalizedBy: { select: { id: true, firstName: true, lastName: true } }, standings: { orderBy: { rank: 'asc' }, take: 3, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } } } }, _count: { select: { tournaments: true, standings: true } } } });
  return res.json(seasons);
});

const seasonBaseSchema = z.object({
  name: z.string().min(2).max(80),
  number: z.coerce.number().int().positive(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().default(false)
});
const seasonSchema = seasonBaseSchema.refine((data) => data.endsAt > data.startsAt, { message: 'Дата окончания должна быть позже начала' });

adminRouter.post('/seasons', async (req, res, next) => {
  try {
    const data = seasonSchema.parse(req.body);
    const season = await prisma.$transaction(async (tx) => {
      if (data.isActive) {
        await tx.season.updateMany({ data: { isActive: false } });
        await tx.user.updateMany({ data: { points: 0 } });
      }
      const created = await tx.season.create({ data });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'SEASON_CREATED', entityType: 'Season', entityId: created.id,
        summary: `Создан сезон «${created.name}»`, after: { name: created.name, number: created.number, startsAt: created.startsAt.toISOString(), endsAt: created.endsAt.toISOString(), isActive: created.isActive },
        metadata: { balancesReset: data.isActive }
      });
      return created;
    });
    return res.status(201).json(season);
  } catch (error) { return next(error); }
});

adminRouter.patch('/seasons/:id', async (req, res, next) => {
  try {
    const patch = seasonBaseSchema.partial().parse(req.body);
    const existing = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Сезон не найден' });
    if (existing.finalizedAt) return res.status(409).json({ message: 'Завершённый сезон доступен только для просмотра' });
    const data = seasonSchema.parse({ ...existing, ...patch });
    const shouldResetBalances = shouldResetSeasonBalances(existing.isActive, data.isActive);
    const season = await prisma.$transaction(async (tx) => {
      if (shouldResetBalances) {
        await tx.season.updateMany({ where: { id: { not: existing.id } }, data: { isActive: false } });
        await tx.user.updateMany({ data: { points: 0 } });
      }
      const updated = await tx.season.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          number: data.number,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          isActive: data.isActive
        }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'SEASON_UPDATED', entityType: 'Season', entityId: existing.id,
        summary: `Обновлён сезон «${existing.name}»`,
        before: { name: existing.name, number: existing.number, startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString(), isActive: existing.isActive },
        after: { name: updated.name, number: updated.number, startsAt: updated.startsAt.toISOString(), endsAt: updated.endsAt.toISOString(), isActive: updated.isActive },
        metadata: { balancesReset: shouldResetBalances }
      });
      return updated;
    });
    return res.json({ ...season, balancesReset: shouldResetBalances });
  } catch (error) { return next(error); }
});

adminRouter.post('/seasons/:id/finalize', async (req, res, next) => {
  try {
    const result = await finalizeSeason(req.params.id, req.auth!.userId);
    return res.json(result);
  } catch (error) { return next(error); }
});

adminRouter.get('/seasons/:id/standings', async (req, res) => {
  const season = await prisma.season.findUnique({ where: { id: req.params.id } });
  if (!season) return res.status(404).json({ message: 'Сезон не найден' });
  return res.json(await prisma.seasonStanding.findMany({ where: { seasonId: season.id }, orderBy: { rank: 'asc' }, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, photoUrl: true } } } }));
});

const tournamentBaseSchema = z.object({
  seasonId: z.string().min(1),
  title: z.string().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  startsAt: z.coerce.date(),
  location: z.string().max(120).optional().nullable(),
  capacity: z.coerce.number().int().min(2).max(1000).default(48),
  participantCount: z.coerce.number().int().min(0).max(1000).default(0),
  status: z.nativeEnum(TournamentStatus).default(TournamentStatus.UPCOMING),
  registrationClosed: z.boolean().default(false),
  registrationDeadline: z.coerce.date().nullable().optional()
});
const tournamentSchema = tournamentBaseSchema.refine((data) => participantsFitCapacity(data.participantCount, data.capacity), {
  message: 'Количество участников не может превышать вместимость',
  path: ['participantCount']
}).refine((data) => !data.registrationDeadline || data.registrationDeadline <= data.startsAt, {
  message: 'Дедлайн регистрации не может быть позже начала турнира',
  path: ['registrationDeadline']
});

adminRouter.get('/tournaments/:id', async (req, res) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
    include: {
      season: true,
      results: { orderBy: { place: 'asc' }, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true, points: true, clubXp: true } } } },
      registrations: {
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        include: { user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true, points: true, clubXp: true, tags: { include: { tag: true } } } } }
      },
      pointBatches: { orderBy: { createdAt: 'desc' }, take: 5, include: { _count: { select: { transactions: true } } } }
    }
  });
  if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
  return res.json({
    ...tournament,
    registrations: tournament.registrations.map((registration) => ({
      ...registration,
      user: { ...registration.user, telegramId: serializeTelegramId(registration.user.telegramId), tags: registration.user.tags.map((item) => item.tag) }
    }))
  });
});

adminRouter.post('/tournaments', async (req, res, next) => {
  try {
    const data = tournamentSchema.parse(req.body);
    const tournament = await prisma.$transaction(async (tx) => {
      const created = await tx.tournament.create({ data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TOURNAMENT_CREATED', entityType: 'Tournament', entityId: created.id, summary: `Создан турнир «${created.title}»`, after: { title: created.title, startsAt: created.startsAt.toISOString(), capacity: created.capacity, location: created.location } });
      return created;
    });
    return res.status(201).json(tournament);
  } catch (error) { return next(error); }
});

adminRouter.patch('/tournaments/:id', async (req, res, next) => {
  try {
    const patch = tournamentBaseSchema.partial().parse(req.body);
    const existing = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Турнир не найден' });
    const data = tournamentSchema.parse({ ...existing, ...patch });
    const tournament = await prisma.$transaction(async (tx) => {
      const updated = await tx.tournament.update({ where: { id: existing.id }, data });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'TOURNAMENT_UPDATED', entityType: 'Tournament', entityId: existing.id, summary: `Обновлён турнир «${existing.title}»`,
        before: { title: existing.title, startsAt: existing.startsAt.toISOString(), location: existing.location, capacity: existing.capacity, status: existing.status, registrationClosed: existing.registrationClosed },
        after: { title: updated.title, startsAt: updated.startsAt.toISOString(), location: updated.location, capacity: updated.capacity, status: updated.status, registrationClosed: updated.registrationClosed }
      });
      return updated;
    });
    return res.json(tournament);
  } catch (error) { return next(error); }
});

adminRouter.delete('/tournaments/:id', async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { results: true } } }
    });
    if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
    if (tournament._count.results > 0 && tournament.status !== TournamentStatus.CANCELLED) {
      return res.status(409).json({ message: 'Турнир с результатами нельзя удалить. Измените его статус на «Отменён».' });
    }
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TOURNAMENT_DELETED', entityType: 'Tournament', entityId: tournament.id, summary: `Удалён турнир «${tournament.title}»`, before: { title: tournament.title, startsAt: tournament.startsAt.toISOString(), status: tournament.status } });
      await tx.tournament.delete({ where: { id: tournament.id } });
    });
    return res.json({ message: 'Турнир удалён' });
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/registrations', async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const result = await registerForTournament(req.params.id, userId, { actorId: req.auth!.userId, actorIsAdmin: true });
    const notification = result.duplicate ? null : await notifyUser(result.user.telegramId, registrationNotification(result.tournament.title, result.tournament.startsAt, result.registration.status === TournamentRegistrationStatus.WAITLISTED ? 'WAITLISTED' : 'REGISTERED'));
    return res.status(result.duplicate ? 200 : 201).json({ ...result, user: { ...result.user, telegramId: serializeTelegramId(result.user.telegramId) }, notification });
  } catch (error) { return next(error); }
});

adminRouter.patch('/registrations/:id', async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.nativeEnum(TournamentRegistrationStatus) }).parse(req.body);
    const result = await updateRegistrationStatus(req.params.id, status, req.auth!.userId);
    const previousStatus = 'previousStatus' in result ? result.previousStatus as TournamentRegistrationStatus : undefined;
    const playerFacingStatus = shouldNotifyRegistrationStatusChange(previousStatus, status);
    const notification = result.duplicate || !playerFacingStatus ? null : await notifyUser(
      result.user.telegramId,
      registrationNotification(result.tournament.title, result.tournament.startsAt, status === TournamentRegistrationStatus.CANCELLED ? 'CANCELLED' : status === TournamentRegistrationStatus.WAITLISTED ? 'WAITLISTED' : 'REGISTERED')
    );
    const promotionNotification = result.promoted
      ? await notifyUser(result.promoted.user.telegramId, registrationNotification(result.tournament.title, result.tournament.startsAt, 'PROMOTED'))
      : null;
    return res.json({ ...result, user: { ...result.user, telegramId: serializeTelegramId(result.user.telegramId) }, promoted: result.promoted ? { ...result.promoted, user: { ...result.promoted.user, telegramId: serializeTelegramId(result.promoted.user.telegramId) } } : null, notification, promotionNotification });
  } catch (error) { return next(error); }
});


const tournamentActionSchema = z.object({
  userId: z.string().min(1),
  targetUserId: z.string().min(1).optional(),
  type: z.nativeEnum(TournamentPlayerActionType),
  value: z.coerce.number().int().min(1).max(100_000).default(1),
  note: z.string().trim().max(300).optional()
}).superRefine((data, context) => {
  if (data.type === TournamentPlayerActionType.BOUNTY && !data.targetUserId) {
    context.addIssue({ code: 'custom', path: ['targetUserId'], message: 'Для баунти укажите выбывшего игрока' });
  }
  if (data.targetUserId && data.targetUserId === data.userId) {
    context.addIssue({ code: 'custom', path: ['targetUserId'], message: 'Игрок не может быть целью самого себя' });
  }
});

adminRouter.get('/tournaments/:id/actions', async (req, res, next) => {
  try {
    const actions = await prisma.tournamentPlayerAction.findMany({
      where: { tournamentId: req.params.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } },
        targetUser: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, username: true } }
      }
    });
    return res.json(actions);
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/actions', async (req, res, next) => {
  try {
    const data = tournamentActionSchema.parse(req.body);
    const action = await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, status: true } });
      if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
      if (tournament.status === TournamentStatus.FINISHED || tournament.status === TournamentStatus.CANCELLED) {
        throw new AppError('Операции доступны только для текущего турнира', 409, 'TOURNAMENT_ACTIONS_LOCKED');
      }
      const registration = await tx.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: data.userId } },
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } } }
      });
      if (!registration || registration.status === TournamentRegistrationStatus.CANCELLED || registration.status === TournamentRegistrationStatus.WAITLISTED) {
        throw new AppError('Игрок должен находиться в основном списке турнира', 409, 'PLAYER_NOT_IN_TOURNAMENT');
      }
      const target = data.targetUserId ? await tx.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: data.targetUserId } },
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true } } }
      }) : null;
      if (data.targetUserId && (!target || target.status === TournamentRegistrationStatus.CANCELLED || target.status === TournamentRegistrationStatus.WAITLISTED)) {
        throw new AppError('Целевой игрок не участвует в турнире', 409, 'TARGET_NOT_IN_TOURNAMENT');
      }
      const lastStateAction = await tx.tournamentPlayerAction.findFirst({
        where: { tournamentId: tournament.id, userId: data.userId, type: { in: [TournamentPlayerActionType.ELIMINATION, TournamentPlayerActionType.REENTRY] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      });
      if (data.type === TournamentPlayerActionType.ELIMINATION && lastStateAction?.type === TournamentPlayerActionType.ELIMINATION) {
        throw new AppError('Игрок уже отмечен выбывшим', 409, 'PLAYER_ALREADY_ELIMINATED');
      }
      if (data.type === TournamentPlayerActionType.REENTRY && lastStateAction?.type !== TournamentPlayerActionType.ELIMINATION) {
        throw new AppError('Повторный вход доступен после выбывания', 409, 'REENTRY_REQUIRES_ELIMINATION');
      }
      if (data.type === TournamentPlayerActionType.REBUY && lastStateAction?.type === TournamentPlayerActionType.ELIMINATION) {
        throw new AppError('Для выбывшего игрока используйте повторный вход', 409, 'REBUY_REQUIRES_ACTIVE_PLAYER');
      }
      if (data.type === TournamentPlayerActionType.BOUNTY && target) {
        const targetLastStateAction = await tx.tournamentPlayerAction.findFirst({
          where: { tournamentId: tournament.id, userId: target.userId, type: { in: [TournamentPlayerActionType.ELIMINATION, TournamentPlayerActionType.REENTRY] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        if (targetLastStateAction?.type !== TournamentPlayerActionType.ELIMINATION) {
          await tx.tournamentSeat.deleteMany({ where: { tournamentId: tournament.id, userId: target.userId } });
          await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
          const eliminated = await tx.tournamentPlayerAction.create({
            data: {
              tournamentId: tournament.id,
              userId: target.userId,
              createdById: req.auth!.userId,
              type: TournamentPlayerActionType.ELIMINATION,
              value: 1,
              note: `Выбывание по баунти от ${registration.user.nickname || registration.user.username || registration.user.firstName}`
            }
          });
          const eliminatedName = target.user.nickname || target.user.username || `${target.user.firstName} ${target.user.lastName ?? ''}`.trim();
          await writeAudit(tx, {
            actorId: req.auth!.userId,
            action: 'TOURNAMENT_ELIMINATION',
            entityType: 'TournamentPlayerAction',
            entityId: eliminated.id,
            summary: `Выбыл по баунти: ${eliminatedName}`,
            after: { tournamentId: tournament.id, userId: target.userId, type: TournamentPlayerActionType.ELIMINATION, value: 1, source: 'BOUNTY', bountyByUserId: data.userId }
          });
        }
      }
      if (data.type === TournamentPlayerActionType.BONUS_XP) {
        await applyClubXpInTransaction(tx, {
          userId: data.userId, amount: data.value, source: ClubXpSource.ADMIN_ADJUSTMENT,
          reason: data.note || `Бонус за турнир «${tournament.title}»`,
          idempotencyKey: `tournament:${tournament.id}:xp:${crypto.randomUUID()}`,
          createdById: req.auth!.userId,
          metadata: { tournamentId: tournament.id }
        });
      }
      if (data.type === TournamentPlayerActionType.ELIMINATION) {
        await tx.tournamentSeat.deleteMany({ where: { tournamentId: tournament.id, userId: data.userId } });
        await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
      }
      const created = await tx.tournamentPlayerAction.create({
        data: { tournamentId: tournament.id, userId: data.userId, targetUserId: data.targetUserId, createdById: req.auth!.userId, type: data.type, value: data.value, note: data.note }
      });
      const playerName = registration.user.nickname || registration.user.username || `${registration.user.firstName} ${registration.user.lastName ?? ''}`.trim();
      const targetName = target ? target.user.nickname || target.user.username || `${target.user.firstName} ${target.user.lastName ?? ''}`.trim() : null;
      const labels: Record<TournamentPlayerActionType, string> = {
        REBUY: `Ребай: ${playerName}`,
        REENTRY: `Повторный вход: ${playerName}`,
        ELIMINATION: `Выбыл: ${playerName}`,
        BOUNTY: `Баунти: ${playerName}${targetName ? ` выбил ${targetName}` : ''}`,
        BONUS_XP: `Бонус ${data.value} Club XP: ${playerName}`
      };
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: `TOURNAMENT_${data.type}`, entityType: 'TournamentPlayerAction', entityId: created.id,
        summary: labels[data.type], after: { tournamentId: tournament.id, userId: data.userId, targetUserId: data.targetUserId ?? null, type: data.type, value: data.value, note: data.note ?? null }
      });
      return created;
    });
    return res.status(201).json(action);
  } catch (error) { return next(error); }
});

const autoSeatingSchema = z.object({
  capacityPerTable: z.coerce.number().int().min(2).max(10),
  tableCount: z.coerce.number().int().positive().optional(),
  onlyCheckedIn: z.boolean().default(false),
  force: z.boolean().default(false)
});
const seatAssignmentSchema = z.object({
  userId: z.string().min(1),
  tableId: z.string().min(1),
  seatNumber: z.coerce.number().int().positive()
});

adminRouter.get('/tournaments/:id/seating', async (req, res, next) => {
  try { return res.json(await getTournamentSeating(req.params.id)); }
  catch (error) { return next(error); }
});


const tableSchema = z.object({ capacity: z.coerce.number().int().min(2).max(10) });

adminRouter.post('/tournaments/:id/seating/tables', async (req, res, next) => {
  try {
    const { capacity } = tableSchema.parse(req.body);
    return res.status(201).json(await createTournamentTable({ tournamentId: req.params.id, actorId: req.auth!.userId, capacity }));
  } catch (error) { return next(error); }
});

adminRouter.patch('/tournaments/:id/seating/tables/:tableId', async (req, res, next) => {
  try {
    const { capacity } = tableSchema.parse(req.body);
    return res.json(await updateTournamentTableCapacity({ tournamentId: req.params.id, tableId: req.params.tableId, actorId: req.auth!.userId, capacity }));
  } catch (error) { return next(error); }
});

adminRouter.delete('/tournaments/:id/seating/tables/:tableId', async (req, res, next) => {
  try {
    return res.json(await closeTournamentTable({ tournamentId: req.params.id, tableId: req.params.tableId, actorId: req.auth!.userId }));
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/seating/generate', async (req, res, next) => {
  try {
    const data = autoSeatingSchema.parse(req.body);
    return res.json(await autoSeatTournament({ tournamentId: req.params.id, actorId: req.auth!.userId, ...data }));
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/seating/assign', async (req, res, next) => {
  try {
    const data = seatAssignmentSchema.parse(req.body);
    return res.json(await assignPlayerSeat({ tournamentId: req.params.id, actorId: req.auth!.userId, ...data }));
  } catch (error) { return next(error); }
});

adminRouter.delete('/tournaments/:id/seating/seats/:seatId', async (req, res, next) => {
  try { return res.json(await unseatPlayer({ tournamentId: req.params.id, actorId: req.auth!.userId, seatId: req.params.seatId })); }
  catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/seating/publish', async (req, res, next) => {
  try {
    const seats = await prisma.tournamentSeat.findMany({
      where: { tournamentId: req.params.id },
      orderBy: [{ table: { number: 'asc' } }, { seatNumber: 'asc' }],
      include: { table: true, user: { select: { id: true, telegramId: true, firstName: true } }, tournament: true }
    });
    if (!seats.length) return res.status(409).json({ message: 'Сначала сформируйте рассадку' });
    const tournament = seats[0].tournament;
    if (tournament.status === TournamentStatus.FINISHED || tournament.status === TournamentStatus.CANCELLED) {
      return res.status(409).json({ message: 'Нельзя публиковать рассадку завершённого или отменённого турнира' });
    }
    const publishedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: publishedAt } });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'SEATING_PUBLISHED', entityType: 'TournamentSeating', entityId: tournament.id,
        summary: `Опубликована рассадка «${tournament.title}»: ${seats.length} игроков`, after: { publishedAt: publishedAt.toISOString(), seats: seats.length }
      });
    });
    const deliveries = await mapWithConcurrency(seats, 8, (seat) => notifyUser(
      seat.user.telegramId,
      `🎲 Рассадка турнира «${tournament.title}» опубликована.\nВаш стол: №${seat.table.number}. Место: №${seat.seatNumber}.`
    ));
    const sentCount = deliveries.filter((item) => item.sent).length;
    return res.json({ seating: await getTournamentSeating(tournament.id), sentCount, failedCount: deliveries.length - sentCount });
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/seating/unpublish', async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
    await prisma.$transaction(async (tx) => {
      await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: null } });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'SEATING_UNPUBLISHED', entityType: 'TournamentSeating', entityId: tournament.id,
        summary: `Рассадка «${tournament.title}» скрыта от игроков`, before: { published: Boolean(tournament.seatingPublishedAt) }, after: { published: false }
      });
    });
    return res.json(await getTournamentSeating(tournament.id));
  } catch (error) { return next(error); }
});

const templateBaseSchema = z.object({
  name: z.string().trim().min(2).max(60),
  title: z.string().trim().min(2).max(100),
  description: z.string().max(500).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  capacity: z.coerce.number().int().min(2).max(1000).default(48),
  recurrenceEnabled: z.boolean().default(false),
  nextStartsAt: z.coerce.date().nullable().optional(),
  weeksAhead: z.coerce.number().int().min(1).max(12).default(4),
  isActive: z.boolean().default(true)
});
const templateSchema = templateBaseSchema.refine((data) => !data.recurrenceEnabled || Boolean(data.nextStartsAt), { message: 'Для еженедельного шаблона укажите дату первой игры', path: ['nextStartsAt'] });

adminRouter.get('/tournament-templates', async (_req, res) => res.json(await prisma.tournamentTemplate.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { tournaments: true } } } })));
adminRouter.post('/tournament-templates', async (req, res, next) => {
  try {
    const data = templateSchema.parse(req.body);
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.tournamentTemplate.create({ data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TOURNAMENT_TEMPLATE_CREATED', entityType: 'TournamentTemplate', entityId: created.id, summary: `Создан шаблон «${created.name}»`, after: { name: created.name, title: created.title, recurrenceEnabled: created.recurrenceEnabled, nextStartsAt: created.nextStartsAt?.toISOString() ?? null } });
      return created;
    });
    let generation: Awaited<ReturnType<typeof generateRecurringTournaments>> | { created: 0; skipped: 'GENERATION_FAILED' } | null = null;
    if (template.recurrenceEnabled) {
      try { generation = await generateRecurringTournaments(req.auth!.userId); }
      catch (error) { console.error('Recurring tournament generation failed after template creation', error); generation = { created: 0, skipped: 'GENERATION_FAILED' }; }
    }
    return res.status(201).json({ ...template, generation });
  } catch (error) { return next(error); }
});
adminRouter.patch('/tournament-templates/:id', async (req, res, next) => {
  try {
    const patch = templateBaseSchema.partial().parse(req.body);
    const existing = await prisma.tournamentTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Шаблон турнира не найден' });
    const data = templateSchema.parse({ ...existing, ...patch });
    const template = await prisma.$transaction(async (tx) => {
      const updated = await tx.tournamentTemplate.update({ where: { id: existing.id }, data });
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TOURNAMENT_TEMPLATE_UPDATED', entityType: 'TournamentTemplate', entityId: existing.id, summary: `Обновлён шаблон «${existing.name}»`, before: { name: existing.name, recurrenceEnabled: existing.recurrenceEnabled, nextStartsAt: existing.nextStartsAt?.toISOString() ?? null }, after: { name: updated.name, recurrenceEnabled: updated.recurrenceEnabled, nextStartsAt: updated.nextStartsAt?.toISOString() ?? null } });
      return updated;
    });
    let generation: Awaited<ReturnType<typeof generateRecurringTournaments>> | { created: 0; skipped: 'GENERATION_FAILED' } | null = null;
    if (template.recurrenceEnabled) {
      try { generation = await generateRecurringTournaments(req.auth!.userId); }
      catch (error) { console.error('Recurring tournament generation failed after template update', error); generation = { created: 0, skipped: 'GENERATION_FAILED' }; }
    }
    return res.json({ ...template, generation });
  } catch (error) { return next(error); }
});
adminRouter.delete('/tournament-templates/:id', async (req, res, next) => {
  try {
    const existing = await prisma.tournamentTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Шаблон турнира не найден' });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: req.auth!.userId, action: 'TOURNAMENT_TEMPLATE_DELETED', entityType: 'TournamentTemplate', entityId: existing.id, summary: `Удалён шаблон «${existing.name}»`, before: { name: existing.name, title: existing.title } });
      await tx.tournamentTemplate.delete({ where: { id: existing.id } });
    });
    return res.json({ message: 'Шаблон удалён' });
  } catch (error) { return next(error); }
});
adminRouter.post('/tournament-templates/run', async (req, res, next) => {
  try { return res.json(await generateRecurringTournaments(req.auth!.userId)); }
  catch (error) { return next(error); }
});

adminRouter.get('/audit', async (req, res, next) => {
  try {
    const query = z.object({
      action: z.string().optional(), entityType: z.string().optional(), actorId: z.string().optional(), search: z.string().max(100).optional(),
      take: z.coerce.number().int().min(1).max(200).default(100)
    }).parse(req.query);
    const logs = await prisma.auditLog.findMany({
      where: {
        action: query.action || undefined,
        entityType: query.entityType || undefined,
        actorId: query.actorId || undefined,
        summary: query.search ? { contains: query.search, mode: 'insensitive' } : undefined
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.take,
      include: { actor: { select: { id: true, firstName: true, lastName: true, username: true } } }
    });
    const [actions, entityTypes] = await Promise.all([
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } })
    ]);
    return res.json({ logs, filters: { actions: actions.map((item) => item.action), entityTypes: entityTypes.map((item) => item.entityType) } });
  } catch (error) { return next(error); }
});

const resultSchema = z.object({
  results: z.array(z.object({ userId: z.string().min(1), place: z.coerce.number().int().positive() })).min(2).max(1000)
}).superRefine(({ results }, ctx) => {
  const users = new Set(results.map((item) => item.userId));
  const places = new Set(results.map((item) => item.place));
  if (users.size !== results.length) ctx.addIssue({ code: 'custom', message: 'Игрок не может встречаться дважды' });
  if (places.size !== results.length) ctx.addIssue({ code: 'custom', message: 'Места не должны повторяться' });
  const sorted = [...places].sort((a, b) => a - b);
  if (sorted.some((place, index) => place !== index + 1)) ctx.addIssue({ code: 'custom', message: 'Места должны идти подряд, начиная с 1' });
});

adminRouter.put('/tournaments/:id/results', async (req, res, next) => {
  try {
    const { results } = resultSchema.parse(req.body);
    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id }, include: { _count: { select: { pointBatches: true } } } });
    if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
    if (tournament._count.pointBatches > 0) return res.status(409).json({ message: 'После пакетного начисления места зафиксированы. Ошибочные очки отменяйте встречной проводкой.' });
    const users = await prisma.user.count({ where: { id: { in: results.map((item) => item.userId) } } });
    if (users !== results.length) return res.status(400).json({ message: 'Один или несколько игроков не найдены' });

    await prisma.$transaction(async (tx) => {
      const previousResults = await tx.tournamentResult.findMany({ where: { tournamentId: tournament.id }, orderBy: { place: 'asc' }, select: { userId: true, place: true } });
      await tx.tournamentResult.deleteMany({ where: { tournamentId: tournament.id } });
      await tx.tournamentResult.createMany({
        data: results.map((item) => ({
          tournamentId: tournament.id,
          userId: item.userId,
          place: item.place,
          points: 0,
          isFinalTable: item.place <= Math.min(8, results.length)
        }))
      });
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { status: TournamentStatus.FINISHED, participantCount: results.length }
      });
      await tx.tournamentRegistration.updateMany({
        where: { tournamentId: tournament.id, userId: { in: results.map((item) => item.userId) }, status: { not: TournamentRegistrationStatus.CANCELLED } },
        data: { status: TournamentRegistrationStatus.PLAYED }
      });
      await writeAudit(tx, {
        actorId: req.auth!.userId, action: 'TOURNAMENT_RESULTS_UPDATED', entityType: 'Tournament', entityId: tournament.id,
        summary: `Сохранены результаты «${tournament.title}»: ${results.length} игроков`, before: previousResults, after: results
      });
    });
    return res.json({ message: 'Места сохранены. Очки начисляются отдельно вручную.' });
  } catch (error) { return next(error); }
});

adminRouter.post('/tournaments/:id/notify', async (req, res, next) => {
  try {
    const result = await notifyAboutTournament(req.params.id);
    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } });
    if (tournament) await writeAudit(prisma, { actorId: req.auth!.userId, action: 'TOURNAMENT_NOTIFICATION_SENT', entityType: 'Tournament', entityId: tournament.id, summary: `Отправлено напоминание «${tournament.title}»`, after: result });
    return res.json(result);
  } catch (error) { return next(error); }
});

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}
