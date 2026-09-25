import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { average, dayKeysBetween, percentage, resolveAnalyticsPeriod, trend, type AnalyticsPeriod } from '../services/analytics.js';
import { clubDayKey } from '../services/loyalty.js';

export const analyticsAdminRouter = Router();

const querySchema = z.object({ period: z.enum(['7d', '30d', '90d', 'season']).default('30d') });
const activeRegistrationStatuses = new Set(['REGISTERED', 'CHECKED_IN', 'PLAYED']);
const attendedRegistrationStatuses = new Set(['CHECKED_IN', 'PLAYED']);

type TournamentRecord = Awaited<ReturnType<typeof loadTournaments>>[number];

function loadTournaments(from: Date, to: Date) {
  return prisma.tournament.findMany({
    where: { startsAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true, title: true, startsAt: true, status: true, capacity: true, participantCount: true,
      registrations: { select: { userId: true, status: true, createdAt: true } },
      results: { select: { userId: true, createdAt: true } },
      pointBatches: { select: { createdAt: true } },
      tables: { select: { capacity: true } },
      seats: { select: { userId: true } }
    }
  });
}

function tournamentAttendance(tournament: TournamentRecord) {
  const registered = new Set(tournament.registrations.filter((item) => activeRegistrationStatuses.has(item.status)).map((item) => item.userId));
  const attended = new Set([
    ...tournament.registrations.filter((item) => attendedRegistrationStatuses.has(item.status)).map((item) => item.userId),
    ...tournament.results.map((item) => item.userId)
  ]);
  const noShows = tournament.status === 'FINISHED'
    ? [...registered].filter((userId) => !attended.has(userId)).length
    : 0;
  return { registered, attended, noShows };
}

function weekdayName(date: Date) {
  const value = new Intl.DateTimeFormat('ru-RU', { timeZone: env.CLUB_TIMEZONE, weekday: 'long' }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

analyticsAdminRouter.get('/', async (req, res, next) => {
  try {
    const { period } = querySchema.parse(req.query) as { period: AnalyticsPeriod };
    const now = new Date();
    const activeSeason = await prisma.season.findFirst({ where: { isActive: true }, select: { startsAt: true } });
    const range = resolveAnalyticsPeriod(period, now, activeSeason?.startsAt);
    const currentWhere = { gte: range.from, lte: range.to };
    const previousWhere = { gte: range.previousFrom, lt: range.previousTo };

    const [
      usersTotal, users, tournaments, previousTournaments, registrations, previousRegistrations,
      events, pointTransactions, clubXpTransactions, dailyHands, achievements,
      referralsCreated, referralsRewarded, notifications, auditActions, previousNewPlayers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({ where: { createdAt: { lte: range.to } }, select: { id: true, firstName: true, lastName: true, username: true, createdAt: true } }),
      loadTournaments(range.from, range.to),
      loadTournaments(range.previousFrom, range.previousTo),
      prisma.tournamentRegistration.findMany({ where: { createdAt: currentWhere, status: { not: 'CANCELLED' } }, select: { userId: true, createdAt: true } }),
      prisma.tournamentRegistration.count({ where: { createdAt: previousWhere, status: { not: 'CANCELLED' } } }),
      prisma.analyticsEvent.findMany({ where: { createdAt: currentWhere }, select: { userId: true, type: true, createdAt: true } }),
      prisma.pointTransaction.findMany({ where: { createdAt: currentWhere }, select: { userId: true, amount: true, createdAt: true } }),
      prisma.clubXpTransaction.findMany({ where: { createdAt: currentWhere }, select: { userId: true, amount: true, source: true, createdAt: true } }),
      prisma.dailyHandAttempt.findMany({ where: { attemptedAt: currentWhere }, select: { userId: true, isCorrect: true, attemptedAt: true } }),
      prisma.userAchievement.count({ where: { unlockedAt: currentWhere } }),
      prisma.referral.count({ where: { createdAt: currentWhere } }),
      prisma.referral.count({ where: { rewardedAt: currentWhere } }),
      prisma.notificationLog.findMany({ where: { createdAt: currentWhere }, select: { sentCount: true, failedCount: true } }),
      prisma.auditLog.count({ where: { createdAt: currentWhere } }),
      prisma.user.count({ where: { createdAt: previousWhere } })
    ]);

    const tournamentRows = tournaments.map((tournament) => {
      const attendance = tournamentAttendance(tournament);
      const tableCapacity = tournament.tables.reduce((sum, table) => sum + table.capacity, 0);
      return {
        id: tournament.id,
        title: tournament.title,
        startsAt: tournament.startsAt,
        status: tournament.status,
        registered: attendance.registered.size,
        attended: attendance.attended.size,
        noShows: attendance.noShows,
        capacity: tournament.capacity,
        occupancy: percentage(attendance.attended.size, tournament.capacity),
        seated: tournament.seats.length,
        tableCapacity,
        seatingOccupancy: percentage(tournament.seats.length, tableCapacity)
      };
    });
    const previousRows = previousTournaments.map((tournament) => ({ tournament, attendance: tournamentAttendance(tournament) }));
    const attendance = tournamentRows.reduce((sum, item) => sum + item.attended, 0);
    const noShows = tournamentRows.reduce((sum, item) => sum + item.noShows, 0);
    const previousAttendance = previousRows.reduce((sum, item) => sum + item.attendance.attended.size, 0);
    const capacity = tournamentRows.reduce((sum, item) => sum + item.capacity, 0);
    const appOpens = events.filter((item) => item.type === 'APP_OPENED');
    const activeIds = new Set([
      ...appOpens.flatMap((item) => item.userId ? [item.userId] : []),
      ...tournaments.flatMap((tournament) => [...tournamentAttendance(tournament).attended])
    ]);
    const newPlayers = users.filter((user) => user.createdAt >= range.from).length;
    const returningPlayers = users.filter((user) => user.createdAt < range.from && activeIds.has(user.id)).length;
    const ratingPtsIssued = pointTransactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const clubXpIssued = clubXpTransactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const notificationSent = notifications.reduce((sum, item) => sum + item.sentCount, 0);
    const notificationFailed = notifications.reduce((sum, item) => sum + item.failedCount, 0);

    const seriesStart = new Date(`${clubDayKey(range.from)}T00:00:00.000Z`);
    const seriesEnd = new Date(`${clubDayKey(range.to)}T00:00:00.000Z`);
    const seriesMap = new Map(dayKeysBetween(seriesStart, seriesEnd).map((day) => [day, {
      day, registrations: 0, attendance: 0, newPlayers: 0, appOpens: 0
    }]));
    for (const registration of registrations) {
      const item = seriesMap.get(clubDayKey(registration.createdAt));
      if (item) item.registrations += 1;
    }
    for (const user of users) {
      const item = seriesMap.get(clubDayKey(user.createdAt));
      if (item && user.createdAt >= range.from) item.newPlayers += 1;
    }
    for (const event of appOpens) {
      const item = seriesMap.get(clubDayKey(event.createdAt));
      if (item) item.appOpens += 1;
    }
    for (const tournament of tournaments) {
      const item = seriesMap.get(clubDayKey(tournament.startsAt));
      if (item) item.attendance += tournamentAttendance(tournament).attended.size;
    }

    const weekdays = new Map<string, { games: number; attendance: number }>();
    const formats = new Map<string, { games: number; attendance: number }>();
    for (const item of tournamentRows) {
      const weekday = weekdayName(new Date(item.startsAt));
      const weekdayEntry = weekdays.get(weekday) ?? { games: 0, attendance: 0 };
      weekdayEntry.games += 1; weekdayEntry.attendance += item.attended; weekdays.set(weekday, weekdayEntry);
      const formatEntry = formats.get(item.title) ?? { games: 0, attendance: 0 };
      formatEntry.games += 1; formatEntry.attendance += item.attended; formats.set(item.title, formatEntry);
    }

    const resultDelays = tournaments.flatMap((tournament) => {
      const first = tournament.results.map((item) => item.createdAt.getTime()).sort((a, b) => a - b)[0];
      return first && first >= tournament.startsAt.getTime() ? [(first - tournament.startsAt.getTime()) / 3_600_000] : [];
    });
    const pointDelays = tournaments.flatMap((tournament) => {
      const first = tournament.pointBatches.map((item) => item.createdAt.getTime()).sort((a, b) => a - b)[0];
      return first && first >= tournament.startsAt.getTime() ? [(first - tournament.startsAt.getTime()) / 3_600_000] : [];
    });

    const growth = new Map<string, { ratingPts: number; clubXp: number }>();
    for (const transaction of pointTransactions) {
      const item = growth.get(transaction.userId) ?? { ratingPts: 0, clubXp: 0 };
      item.ratingPts += transaction.amount; growth.set(transaction.userId, item);
    }
    for (const transaction of clubXpTransactions) {
      const item = growth.get(transaction.userId) ?? { ratingPts: 0, clubXp: 0 };
      item.clubXp += transaction.amount; growth.set(transaction.userId, item);
    }
    const usersById = new Map(users.map((user) => [user.id, user]));
    const growthLeaders = [...growth.entries()].map(([userId, values]) => {
      const user = usersById.get(userId);
      return { userId, name: user ? `${user.firstName} ${user.lastName ?? ''}`.trim() : 'Игрок', username: user?.username ?? null, ...values };
    }).filter((item) => item.ratingPts > 0 || item.clubXp > 0).sort((left, right) => (right.ratingPts + right.clubXp) - (left.ratingPts + left.clubXp)).slice(0, 6);

    return res.json({
      period: { key: period, label: range.label, from: range.from, to: range.to },
      summary: {
        usersTotal, newPlayers, activePlayers: activeIds.size, returningPlayers,
        returningShare: percentage(returningPlayers, activeIds.size), registrations: registrations.length,
        attendance, noShows, attendanceRate: percentage(attendance, attendance + noShows),
        tournaments: tournaments.length, averageAttendance: average(tournamentRows.map((item) => item.attended)),
        tableOccupancy: percentage(attendance, capacity), ratingPtsIssued, clubXpIssued,
        trends: {
          newPlayers: trend(newPlayers, previousNewPlayers),
          registrations: trend(registrations.length, previousRegistrations),
          attendance: trend(attendance, previousAttendance)
        }
      },
      engagement: {
        appOpens: appOpens.length, uniqueAppUsers: new Set(appOpens.flatMap((item) => item.userId ? [item.userId] : [])).size,
        dailyHandAttempts: dailyHands.length, dailyHandCorrect: dailyHands.filter((item) => item.isCorrect).length,
        dailyHandSuccessRate: percentage(dailyHands.filter((item) => item.isCorrect).length, dailyHands.length),
        achievementsUnlocked: achievements, referralsCreated, referralsRewarded,
        referralConversion: percentage(referralsRewarded, referralsCreated), adminActions: auditActions
      },
      delivery: { sent: notificationSent, failed: notificationFailed, rate: percentage(notificationSent, notificationSent + notificationFailed) },
      operations: { averageResultDelayHours: average(resultDelays), averagePointsDelayHours: average(pointDelays) },
      timeSeries: [...seriesMap.values()],
      weekdays: [...weekdays.entries()].map(([name, value]) => ({ name, ...value, averageAttendance: average([value.attendance / value.games]) })).sort((a, b) => b.attendance - a.attendance),
      formats: [...formats.entries()].map(([title, value]) => ({ title, ...value, averageAttendance: average([value.attendance / value.games]) })).sort((a, b) => b.attendance - a.attendance).slice(0, 8),
      tournaments: [...tournamentRows].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()).slice(0, 20),
      growthLeaders
    });
  } catch (error) { return next(error); }
});
