import { PointTransactionType, PrismaClient, ReasonPresetKind, TournamentRegistrationStatus, TournamentStatus, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const players = [
  [111111111n, 'Алексей', 'Ковалёв', 'AK', UserRole.ADMIN],
  [222222222n, 'Максим', 'Орлов', 'MaxPoker', UserRole.PLAYER],
  [333333333n, 'Роман', 'Фролов', 'RiverFox', UserRole.PLAYER],
  [444444444n, 'Александр', 'Смирнов', 'AlexStorm', UserRole.PLAYER],
  [555555555n, 'Мария', 'Волкова', 'MaryAce', UserRole.PLAYER],
  [666666666n, 'Денис', 'Левин', 'DL', UserRole.PLAYER],
  [777777777n, 'Илья', 'Петров', 'IP', UserRole.PLAYER],
  [888888888n, 'Анна', 'Мирова', 'AM', UserRole.PLAYER]
] as const;

async function main() {
  await prisma.analyticsEvent.deleteMany();
  await prisma.dailyHandAttempt.deleteMany();
  await prisma.userAchievement.deleteMany();
  await prisma.clubXpTransaction.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.seasonStanding.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userTag.deleteMany();
  await prisma.playerTag.deleteMany();
  await prisma.tournamentRegistration.deleteMany();
  await prisma.browserSession.deleteMany();
  await prisma.browserAccessInvite.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.pointBatch.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.tournamentResult.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.tournamentTemplate.deleteMany();
  await prisma.reasonPreset.deleteMany();
  await prisma.season.deleteMany();
  await prisma.user.deleteMany();

  const users = [];
  for (const [telegramId, firstName, lastName, username, role] of players) {
    users.push(await prisma.user.create({
      data: { telegramId, firstName, lastName, username, role }
    }));
  }

  await prisma.reasonPreset.createMany({
    data: [
      { id: 'reason-participation', label: 'Участие', reason: 'Участие в турнире', kind: ReasonPresetKind.AWARD, sortOrder: 10 },
      { id: 'reason-podium', label: 'Призовое место', reason: 'Призовое место', kind: ReasonPresetKind.AWARD, sortOrder: 20 },
      { id: 'reason-bonus', label: 'Бонус', reason: 'Бонус клуба', kind: ReasonPresetKind.AWARD, sortOrder: 30 },
      { id: 'reason-correction', label: 'Корректировка', reason: 'Корректировка результата', kind: ReasonPresetKind.BOTH, sortOrder: 40 },
      { id: 'reason-violation', label: 'Нарушение', reason: 'Нарушение регламента', kind: ReasonPresetKind.DEDUCTION, sortOrder: 50 }
    ]
  });
  const vipTag = await prisma.playerTag.create({ data: { name: 'VIP', color: '#f2b84b' } });
  const organizerTag = await prisma.playerTag.create({ data: { name: 'Организатор', color: '#46d98b' } });
  await prisma.userTag.createMany({ data: [{ userId: users[0].id, tagId: organizerTag.id }, { userId: users[1].id, tagId: vipTag.id }] });

  const now = new Date();
  const seasonStart = new Date(now);
  seasonStart.setDate(seasonStart.getDate() - 42);
  const seasonEnd = new Date(now);
  seasonEnd.setDate(seasonEnd.getDate() + 42);

  const season = await prisma.season.create({
    data: { name: 'Сезон 04', number: 4, startsAt: seasonStart, endsAt: seasonEnd, isActive: true }
  });
  const balances = new Map(users.map((user) => [user.id, 0]));
  const demoAwards = [600, 480, 400, 340, 300, 260, 230, 210];

  for (let week = 1; week <= 6; week += 1) {
    const startsAt = new Date(seasonStart);
    startsAt.setDate(startsAt.getDate() + week * 7);
    startsAt.setHours(20, 0, 0, 0);
    const tournament = await prisma.tournament.create({
      data: {
        seasonId: season.id,
        title: week % 2 ? 'Пятничный турнир' : 'Клубный вечер',
        description: 'Еженедельный спортивный турнир клуба',
        startsAt,
        location: 'Poker Club',
        capacity: 48,
        participantCount: users.length,
        status: TournamentStatus.FINISHED
      }
    });

    const rotated = [...users].sort((a, b) => {
      const av = (Number(a.telegramId! % 97n) + week * 11) % 53;
      const bv = (Number(b.telegramId! % 97n) + week * 11) % 53;
      return av - bv;
    });
    await prisma.tournamentResult.createMany({
      data: rotated.map((user, index) => ({
        tournamentId: tournament.id,
        userId: user.id,
        place: index + 1,
        points: 0,
        isFinalTable: index < 8
      }))
    });

    const awardedAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
    for (const [index, user] of rotated.entries()) {
      const amount = demoAwards[index] ?? 50;
      const balanceAfter = (balances.get(user.id) ?? 0) + amount;
      balances.set(user.id, balanceAfter);
      await prisma.pointTransaction.create({
        data: {
          userId: user.id,
          seasonId: season.id,
          createdById: users[0].id,
          type: PointTransactionType.AWARD,
          amount,
          balanceAfter,
          reason: `${tournament.title}: ${index + 1} место`,
          createdAt: awardedAt
        }
      });
    }
  }

  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7 || 7));
  nextFriday.setHours(20, 0, 0, 0);
  const upcoming = await prisma.tournament.create({
    data: {
      seasonId: season.id,
      title: 'Пятничный турнир',
      description: 'Главная игра недели. Результаты входят в рейтинг сезона.',
      startsAt: nextFriday,
      location: 'Poker Club',
      capacity: 48,
      participantCount: 38,
      status: TournamentStatus.UPCOMING
    }
  });

  await prisma.tournamentRegistration.createMany({
    data: users.slice(0, 5).map((user) => ({ tournamentId: upcoming.id, userId: user.id, status: TournamentRegistrationStatus.REGISTERED }))
  });
  await prisma.tournament.update({ where: { id: upcoming.id }, data: { participantCount: 5 } });

  for (const [userId, total] of balances) {
    await prisma.user.update({ where: { id: userId }, data: { points: total } });
  }
}

main()
  .then(() => console.log('Демо-данные Poker Club созданы'))
  .finally(async () => prisma.$disconnect());
