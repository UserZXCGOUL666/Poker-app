import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';

export async function finalizeSeason(seasonId: string, adminId: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
    const season = await tx.season.findUnique({ where: { id: seasonId }, include: { standings: true } });
    if (!season) throw new AppError('Сезон не найден', 404, 'SEASON_NOT_FOUND');
    if (season.finalizedAt) {
      const standings = await tx.seasonStanding.findMany({ where: { seasonId }, orderBy: { rank: 'asc' }, include: { user: true } });
      return { season, standings, duplicate: true };
    }
    if (!season.isActive) throw new AppError('Завершить можно только активный сезон', 409, 'SEASON_NOT_ACTIVE');
    const users = await tx.user.findMany({ orderBy: [{ points: 'desc' }, { createdAt: 'asc' }], select: { id: true, points: true, firstName: true, lastName: true, username: true } });
    const finalizedAt = new Date();
    await tx.seasonStanding.createMany({ data: users.map((user, index) => ({ seasonId, userId: user.id, rank: index + 1, points: user.points })) });
    const finalized = await tx.season.update({ where: { id: seasonId }, data: { isActive: false, finalizedAt, finalizedById: adminId } });
    await writeAudit(tx, {
      actorId: adminId,
      action: 'SEASON_FINALIZED',
      entityType: 'Season',
      entityId: seasonId,
      summary: `Завершён сезон «${season.name}»`,
      before: { isActive: true, finalizedAt: null },
      after: { isActive: false, finalizedAt: finalizedAt.toISOString(), players: users.length },
      metadata: { winners: users.slice(0, 3).map((user, index) => ({ userId: user.id, rank: index + 1, points: user.points })) }
    });
    return { season: finalized, standings: users.map((user, index) => ({ ...user, rank: index + 1 })), duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new AppError('Не удалось завершить сезон. Повторите попытку.', 409, 'SEASON_FINALIZATION_CONFLICT');
}
