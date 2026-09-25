import { PointTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';

type PointChangeInput = {
  userId: string;
  adminId: string;
  amount: number;
  reason: string;
  idempotencyKey?: string;
};

export function calculateBalanceAfter(currentBalance: number, amount: number) {
  const balanceAfter = currentBalance + amount;
  if (balanceAfter < 0) {
    throw new AppError(`Нельзя списать больше ${currentBalance} PTS`, 409, 'INSUFFICIENT_POINTS');
  }
  return balanceAfter;
}

export async function applyManualPointChange(input: PointChangeInput) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (input.idempotencyKey) {
          const existing = await tx.pointTransaction.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: {
              user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true } },
              createdBy: { select: { id: true, firstName: true, lastName: true } },
              season: { select: { id: true, name: true } }
            }
          });
          if (existing) return { transaction: existing, user: existing.user, duplicate: true };
        }

        const [season, user] = await Promise.all([
          tx.season.findFirst({ where: { isActive: true, finalizedAt: null }, select: { id: true, name: true } }),
          tx.user.findUnique({ where: { id: input.userId }, select: { id: true, points: true } })
        ]);
        if (!season) throw new AppError('Сначала создайте активный сезон', 409, 'NO_ACTIVE_SEASON');
        if (!user) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');

        calculateBalanceAfter(user.points, input.amount);

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { points: { increment: input.amount } },
          select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true }
        });
        const transaction = await tx.pointTransaction.create({
          data: {
            userId: user.id,
            seasonId: season.id,
            createdById: input.adminId,
            type: input.amount > 0 ? PointTransactionType.AWARD : PointTransactionType.DEDUCTION,
            amount: input.amount,
            balanceAfter: updatedUser.points,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey
          },
          include: {
            user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            season: { select: { id: true, name: true } }
          }
        });
        await writeAudit(tx, {
          actorId: input.adminId,
          action: input.amount > 0 ? 'POINTS_AWARDED' : 'POINTS_DEDUCTED',
          entityType: 'PointTransaction',
          entityId: transaction.id,
          summary: `${input.amount > 0 ? 'Начислено' : 'Списано'} ${Math.abs(input.amount)} PTS: ${updatedUser.firstName}`,
          after: { userId: user.id, amount: input.amount, balanceAfter: updatedUser.points, reason: input.reason }
        });
        return { transaction, user: updatedUser, duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && input.idempotencyKey) {
        const existing = await prisma.pointTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: {
            user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            season: { select: { id: true, name: true } }
          }
        });
        if (existing) return { transaction: existing, user: existing.user, duplicate: true };
      }
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new AppError('Не удалось изменить баланс. Повторите попытку.', 409, 'POINTS_CONFLICT');
}
