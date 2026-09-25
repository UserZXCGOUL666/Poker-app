import { PointTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';
import { calculateBalanceAfter } from './points.js';

type BulkPointEntry = { userId: string; amount: number; reason: string };

type BulkPointInput = {
  adminId: string;
  tournamentId?: string;
  idempotencyKey: string;
  note?: string;
  entries: BulkPointEntry[];
};

type ReversePointInput = {
  adminId: string;
  transactionId: string;
  reason: string;
  idempotencyKey: string;
};

export async function applyBulkPointChanges(input: BulkPointInput) {
  try {
    return await withSerializableRetry(async (tx) => {
    const existing = await tx.pointBatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { transactions: { include: { user: true } } }
    });
    if (existing) return { batch: existing, duplicate: true };

    const season = await tx.season.findFirst({ where: { isActive: true, finalizedAt: null }, select: { id: true, name: true } });
    if (!season) throw new AppError('Сначала создайте активный незавершённый сезон', 409, 'NO_ACTIVE_SEASON');
    if (input.tournamentId) {
      if (input.entries.some((entry) => entry.amount <= 0)) throw new AppError('Пакет по итогам турнира может только начислять положительные очки', 400, 'INVALID_TOURNAMENT_SCORE');
      const tournament = await tx.tournament.findUnique({
        where: { id: input.tournamentId },
        select: { id: true, seasonId: true, title: true, status: true, results: { select: { userId: true } } }
      });
      if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
      if (tournament.seasonId !== season.id) throw new AppError('Турнир относится не к активному сезону', 409, 'WRONG_SEASON');
      if (tournament.status !== 'FINISHED' || tournament.results.length < 2) throw new AppError('Сначала сохраните результаты турнира', 409, 'RESULTS_REQUIRED');
      const resultUsers = new Set(tournament.results.map((item) => item.userId));
      if (input.entries.some((entry) => !resultUsers.has(entry.userId))) throw new AppError('Начислять пакет можно только игрокам из результатов турнира', 409, 'PLAYER_NOT_IN_RESULTS');
    }

    const batch = await tx.pointBatch.create({
      data: {
        tournamentId: input.tournamentId,
        createdById: input.adminId,
        idempotencyKey: input.idempotencyKey,
        note: input.note
      }
    });
    const transactions = [];
    for (const entry of input.entries) {
      const user = await tx.user.findUnique({ where: { id: entry.userId }, select: { id: true, points: true } });
      if (!user) throw new AppError('Один из игроков не найден', 404, 'USER_NOT_FOUND');
      calculateBalanceAfter(user.points, entry.amount);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { points: { increment: entry.amount } },
        select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true }
      });
      const transaction = await tx.pointTransaction.create({
        data: {
          userId: user.id,
          seasonId: season.id,
          createdById: input.adminId,
          batchId: batch.id,
          type: entry.amount > 0 ? PointTransactionType.AWARD : PointTransactionType.DEDUCTION,
          amount: entry.amount,
          balanceAfter: updated.points,
          reason: entry.reason
        },
        include: { user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true } } }
      });
      if (input.tournamentId) {
        await tx.tournamentResult.update({
          where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: user.id } },
          data: { points: entry.amount }
        });
      }
      transactions.push(transaction);
    }

    await writeAudit(tx, {
      actorId: input.adminId,
      action: 'POINTS_BATCH_CREATED',
      entityType: 'PointBatch',
      entityId: batch.id,
      summary: `Массовое изменение очков: ${transactions.length} игроков`,
      after: transactions.map((item) => ({ userId: item.userId, amount: item.amount, balanceAfter: item.balanceAfter, reason: item.reason })),
      metadata: { tournamentId: input.tournamentId ?? null, seasonId: season.id }
    });
    return { batch: { ...batch, transactions }, duplicate: false };
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.pointBatch.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { transactions: { include: { user: true } } }
      });
      if (existing) return { batch: existing, duplicate: true };
      if (input.tournamentId) {
        const tournamentBatch = await prisma.pointBatch.findUnique({ where: { tournamentId: input.tournamentId } });
        if (tournamentBatch) throw new AppError('Очки по этому турниру уже начислены. Для исправлений используйте отмену операции.', 409, 'TOURNAMENT_ALREADY_SCORED');
      }
    }
    throw error;
  }
}

export async function reversePointTransaction(input: ReversePointInput) {
  try {
    return await withSerializableRetry(async (tx) => {
    const duplicate = await tx.pointTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { user: true, reversalOf: true }
    });
    if (duplicate) return { transaction: duplicate, duplicate: true };

    const original = await tx.pointTransaction.findUnique({
      where: { id: input.transactionId },
      include: {
        reversedBy: true,
        user: { select: { id: true, points: true, firstName: true, telegramId: true } },
        season: true,
        batch: { select: { tournamentId: true } }
      }
    });
    if (!original) throw new AppError('Операция не найдена', 404, 'TRANSACTION_NOT_FOUND');
    if (original.reversalOfId) throw new AppError('Нельзя отменить компенсирующую операцию', 409, 'REVERSAL_OF_REVERSAL');
    if (original.reversedBy) throw new AppError('Эта операция уже отменена', 409, 'ALREADY_REVERSED');
    if (!original.season.isActive || original.season.finalizedAt) {
      throw new AppError('Можно отменять операции только текущего незавершённого сезона', 409, 'SEASON_CLOSED');
    }

    const amount = -original.amount;
    calculateBalanceAfter(original.user.points, amount);
    const updated = await tx.user.update({
      where: { id: original.userId },
      data: { points: { increment: amount } },
      select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true }
    });
    const transaction = await tx.pointTransaction.create({
      data: {
        userId: original.userId,
        seasonId: original.seasonId,
        createdById: input.adminId,
        type: PointTransactionType.CORRECTION,
        amount,
        balanceAfter: updated.points,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        reversalOfId: original.id
      },
      include: { user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true, points: true } } }
    });
    if (original.batch?.tournamentId) {
      await tx.tournamentResult.update({
        where: { tournamentId_userId: { tournamentId: original.batch.tournamentId, userId: original.userId } },
        data: { points: { increment: amount } }
      });
    }

    await writeAudit(tx, {
      actorId: input.adminId,
      action: 'POINTS_REVERSED',
      entityType: 'PointTransaction',
      entityId: original.id,
      summary: `Отмена операции ${original.amount > 0 ? '+' : ''}${original.amount} PTS`,
      before: { amount: original.amount, balanceAfter: original.balanceAfter, reason: original.reason },
      after: { reversalId: transaction.id, amount, balanceAfter: transaction.balanceAfter, reason: transaction.reason }
    });
    return { transaction, duplicate: false };
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.pointTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { user: true, reversalOf: true }
      });
      if (existing) return { transaction: existing, duplicate: true };
    }
    throw error;
  }
}

async function withSerializableRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new AppError('Не удалось сохранить операцию. Повторите попытку.', 409, 'TRANSACTION_CONFLICT');
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
