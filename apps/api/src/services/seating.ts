import { createHash, randomBytes } from 'node:crypto';
import { Prisma, TournamentRegistrationStatus, TournamentStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';

const seatableStatuses = [TournamentRegistrationStatus.REGISTERED, TournamentRegistrationStatus.CHECKED_IN] as const;
const isLockedStatus = (status: TournamentStatus) => status === TournamentStatus.FINISHED || status === TournamentStatus.CANCELLED;

export type SeatingPlan = {
  seed: string;
  tableCount: number;
  capacityPerTable: number;
  tables: { number: number; userSeats: { userId: string; seatNumber: number }[] }[];
};

function deterministicOrder(seed: string, scope: string, value: string | number) {
  return createHash('sha256').update(`${seed}:${scope}:${value}`).digest('hex');
}

export function buildSeatingPlan(
  userIds: string[],
  capacityPerTable: number,
  requestedTableCount?: number,
  seed = randomBytes(18).toString('hex')
): SeatingPlan {
  if (userIds.length === 0) throw new AppError('Нет игроков для рассадки', 409, 'NO_PLAYERS_TO_SEAT');
  if (new Set(userIds).size !== userIds.length) throw new AppError('В списке рассадки есть дубликаты', 400, 'DUPLICATE_PLAYERS');
  if (!Number.isInteger(capacityPerTable) || capacityPerTable < 2 || capacityPerTable > 10) {
    throw new AppError('За столом может быть от 2 до 10 мест', 400, 'INVALID_TABLE_CAPACITY');
  }

  const minimumTableCount = Math.ceil(userIds.length / capacityPerTable);
  const tableCount = requestedTableCount ?? minimumTableCount;
  if (!Number.isInteger(tableCount) || tableCount < minimumTableCount || tableCount > userIds.length) {
    throw new AppError(
      `Для ${userIds.length} игроков требуется от ${minimumTableCount} до ${userIds.length} столов`,
      400,
      'INVALID_TABLE_COUNT'
    );
  }

  const orderedUsers = [...userIds].sort((a, b) => deterministicOrder(seed, 'player', a).localeCompare(deterministicOrder(seed, 'player', b)));
  const baseSize = Math.floor(userIds.length / tableCount);
  const largerTables = userIds.length % tableCount;
  let cursor = 0;
  const tables = Array.from({ length: tableCount }, (_, index) => {
    const playerCount = baseSize + (index < largerTables ? 1 : 0);
    const seatNumbers = Array.from({ length: capacityPerTable }, (_, seatIndex) => seatIndex + 1)
      .sort((a, b) => deterministicOrder(seed, `table-${index + 1}`, a).localeCompare(deterministicOrder(seed, `table-${index + 1}`, b)));
    const users = orderedUsers.slice(cursor, cursor + playerCount);
    cursor += playerCount;
    return {
      number: index + 1,
      userSeats: users.map((userId, userIndex) => ({ userId, seatNumber: seatNumbers[userIndex] }))
    };
  });

  return { seed, tableCount, capacityPerTable, tables };
}

function isRetryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002');
}

async function serializable<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

export async function getTournamentSeating(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true, title: true, startsAt: true, status: true, seatingPublishedAt: true, seatingVersion: true,
      tables: {
        orderBy: { number: 'asc' },
        include: { seats: { orderBy: { seatNumber: 'asc' }, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } } } } }
      },
      registrations: {
        where: { status: { in: [...seatableStatuses] } },
        orderBy: [{ status: 'desc' }, { createdAt: 'asc' }],
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true, nickname: true, photoUrl: true } } }
      }
    }
  });
  if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
  const seatedIds = new Set(tournament.tables.flatMap((table) => table.seats.map((seat) => seat.userId)));
  return {
    tournament: {
      id: tournament.id, title: tournament.title, startsAt: tournament.startsAt, status: tournament.status,
      seatingPublishedAt: tournament.seatingPublishedAt, seatingVersion: tournament.seatingVersion
    },
    tables: tournament.tables,
    registrations: tournament.registrations,
    unseated: tournament.registrations.filter((registration) => !seatedIds.has(registration.userId)),
    eligibleCount: tournament.registrations.length,
    seatedCount: seatedIds.size
  };
}

export async function autoSeatTournament(input: {
  tournamentId: string;
  actorId: string;
  capacityPerTable: number;
  tableCount?: number;
  onlyCheckedIn: boolean;
  force?: boolean;
}) {
  await serializable(() => prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: input.tournamentId },
      include: {
        registrations: {
          where: { status: input.onlyCheckedIn ? TournamentRegistrationStatus.CHECKED_IN : { in: [...seatableStatuses] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { userId: true }
        },
        _count: { select: { seats: true, tables: true } }
      }
    });
    if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
    if (isLockedStatus(tournament.status)) {
      throw new AppError('Нельзя менять рассадку завершённого или отменённого турнира', 409, 'SEATING_LOCKED');
    }
    if (tournament.seatingPublishedAt && !input.force) {
      throw new AppError('Рассадка уже опубликована. Подтвердите пересоздание.', 409, 'SEATING_PUBLISHED');
    }
    if (input.onlyCheckedIn && tournament.registrations.length === 0) {
      throw new AppError('Никто ещё не отметил присутствие. Отключите фильтр или выполните чек-ин.', 409, 'NO_CHECKED_IN_PLAYERS');
    }

    const plan = buildSeatingPlan(tournament.registrations.map((entry) => entry.userId), input.capacityPerTable, input.tableCount);
    await tx.tournamentTable.deleteMany({ where: { tournamentId: tournament.id } });
    for (const tablePlan of plan.tables) {
      const table = await tx.tournamentTable.create({
        data: { tournamentId: tournament.id, number: tablePlan.number, capacity: plan.capacityPerTable }
      });
      if (tablePlan.userSeats.length) {
        await tx.tournamentSeat.createMany({
          data: tablePlan.userSeats.map((seat) => ({ tournamentId: tournament.id, tableId: table.id, userId: seat.userId, seatNumber: seat.seatNumber }))
        });
      }
    }
    await tx.tournament.update({
      where: { id: tournament.id },
      data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } }
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: tournament._count.seats ? 'SEATING_REGENERATED' : 'SEATING_GENERATED',
      entityType: 'TournamentSeating',
      entityId: tournament.id,
      summary: `Сформирована рассадка «${tournament.title}»: ${tournament.registrations.length} игроков, ${plan.tableCount} столов`,
      before: { tables: tournament._count.tables, seats: tournament._count.seats, published: Boolean(tournament.seatingPublishedAt) },
      after: { tables: plan.tableCount, seats: tournament.registrations.length, capacityPerTable: plan.capacityPerTable, onlyCheckedIn: input.onlyCheckedIn },
      metadata: { randomSeed: plan.seed }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return getTournamentSeating(input.tournamentId);
}

export async function assignPlayerSeat(input: { tournamentId: string; actorId: string; userId: string; tableId: string; seatNumber: number }) {
  await serializable(() => prisma.$transaction(async (tx) => {
    const [tournament, table, registration, existing, target] = await Promise.all([
      tx.tournament.findUnique({ where: { id: input.tournamentId } }),
      tx.tournamentTable.findUnique({ where: { id: input.tableId } }),
      tx.tournamentRegistration.findUnique({ where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: input.userId } } }),
      tx.tournamentSeat.findUnique({ where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: input.userId } } }),
      tx.tournamentSeat.findUnique({ where: { tableId_seatNumber: { tableId: input.tableId, seatNumber: input.seatNumber } } })
    ]);
    if (!tournament || !table || table.tournamentId !== tournament.id) throw new AppError('Стол или турнир не найден', 404, 'TABLE_NOT_FOUND');
    if (isLockedStatus(tournament.status)) throw new AppError('Рассадка заблокирована', 409, 'SEATING_LOCKED');
    if (!registration || !seatableStatuses.includes(registration.status as typeof seatableStatuses[number])) throw new AppError('Игрок не находится в основном списке турнира', 409, 'PLAYER_NOT_REGISTERED');
    if (input.seatNumber < 1 || input.seatNumber > table.capacity) throw new AppError('Такого места за столом нет', 400, 'INVALID_SEAT');
    if (existing && existing.tableId === table.id && existing.seatNumber === input.seatNumber) return;

    if (!existing) {
      if (target) throw new AppError('Место уже занято', 409, 'SEAT_OCCUPIED');
      await tx.tournamentSeat.create({ data: { tournamentId: tournament.id, tableId: table.id, userId: input.userId, seatNumber: input.seatNumber } });
    } else if (!target) {
      await tx.tournamentSeat.update({ where: { id: existing.id }, data: { tableId: table.id, seatNumber: input.seatNumber, assignedAt: new Date() } });
    } else {
      const sourceTable = await tx.tournamentTable.findUnique({ where: { id: existing.tableId } });
      if (!sourceTable) throw new AppError('Исходный стол не найден', 409, 'SOURCE_TABLE_NOT_FOUND');
      await tx.tournamentSeat.update({ where: { id: existing.id }, data: { seatNumber: -1 } });
      await tx.tournamentSeat.update({ where: { id: target.id }, data: { tableId: sourceTable.id, seatNumber: existing.seatNumber, assignedAt: new Date() } });
      await tx.tournamentSeat.update({ where: { id: existing.id }, data: { tableId: table.id, seatNumber: input.seatNumber, assignedAt: new Date() } });
    }

    await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: input.actorId, action: existing ? (target ? 'SEATS_SWAPPED' : 'PLAYER_MOVED') : 'PLAYER_SEATED', entityType: 'TournamentSeating', entityId: tournament.id,
      summary: `${existing ? target ? 'Игроки поменяны местами' : 'Игрок пересажен' : 'Игрок посажен'} в турнире «${tournament.title}»`,
      before: existing ? { userId: input.userId, tableId: existing.tableId, seatNumber: existing.seatNumber } : undefined,
      after: { userId: input.userId, tableId: table.id, tableNumber: table.number, seatNumber: input.seatNumber },
      metadata: target ? { swappedWithUserId: target.userId } : undefined
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return getTournamentSeating(input.tournamentId);
}

export async function unseatPlayer(input: { tournamentId: string; actorId: string; seatId: string }) {
  await prisma.$transaction(async (tx) => {
    const seat = await tx.tournamentSeat.findUnique({ where: { id: input.seatId }, include: { tournament: true, table: true } });
    if (!seat || seat.tournamentId !== input.tournamentId) throw new AppError('Место не найдено', 404, 'SEAT_NOT_FOUND');
    if (isLockedStatus(seat.tournament.status)) throw new AppError('Рассадка заблокирована', 409, 'SEATING_LOCKED');
    await tx.tournamentSeat.delete({ where: { id: seat.id } });
    await tx.tournament.update({ where: { id: seat.tournamentId }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: input.actorId, action: 'PLAYER_UNSEATED', entityType: 'TournamentSeating', entityId: seat.tournamentId,
      summary: `Игрок снят с места в турнире «${seat.tournament.title}»`,
      before: { userId: seat.userId, tableNumber: seat.table.number, seatNumber: seat.seatNumber }
    });
  });
  return getTournamentSeating(input.tournamentId);
}

export async function createTournamentTable(input: { tournamentId: string; actorId: string; capacity: number }) {
  await serializable(() => prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: input.tournamentId },
      include: { tables: { orderBy: { number: 'desc' }, take: 1 } }
    });
    if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
    if (isLockedStatus(tournament.status)) throw new AppError('Нельзя менять столы завершённого или отменённого турнира', 409, 'SEATING_LOCKED');
    if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 10) {
      throw new AppError('За столом может быть от 2 до 10 мест', 400, 'INVALID_TABLE_CAPACITY');
    }
    const number = (tournament.tables[0]?.number ?? 0) + 1;
    const table = await tx.tournamentTable.create({ data: { tournamentId: tournament.id, number, capacity: input.capacity } });
    await tx.tournament.update({ where: { id: tournament.id }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: input.actorId, action: 'TOURNAMENT_TABLE_CREATED', entityType: 'TournamentSeating', entityId: tournament.id,
      summary: `Создан стол №${number} для «${tournament.title}»`, after: { tableId: table.id, number, capacity: table.capacity }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return getTournamentSeating(input.tournamentId);
}

export async function updateTournamentTableCapacity(input: { tournamentId: string; tableId: string; actorId: string; capacity: number }) {
  await serializable(() => prisma.$transaction(async (tx) => {
    const table = await tx.tournamentTable.findFirst({
      where: { id: input.tableId, tournamentId: input.tournamentId },
      include: { tournament: true, seats: { orderBy: { seatNumber: 'desc' }, take: 1 } }
    });
    if (!table) throw new AppError('Стол не найден', 404, 'TABLE_NOT_FOUND');
    if (isLockedStatus(table.tournament.status)) throw new AppError('Нельзя менять столы завершённого или отменённого турнира', 409, 'SEATING_LOCKED');
    if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 10) {
      throw new AppError('За столом может быть от 2 до 10 мест', 400, 'INVALID_TABLE_CAPACITY');
    }
    const highestOccupiedSeat = table.seats[0]?.seatNumber ?? 0;
    if (input.capacity < highestOccupiedSeat) {
      throw new AppError(`Сначала освободите места выше №${input.capacity}`, 409, 'TABLE_CAPACITY_OCCUPIED');
    }
    await tx.tournamentTable.update({ where: { id: table.id }, data: { capacity: input.capacity } });
    await tx.tournament.update({ where: { id: table.tournamentId }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: input.actorId, action: 'TOURNAMENT_TABLE_UPDATED', entityType: 'TournamentSeating', entityId: table.tournamentId,
      summary: `Изменено количество мест за столом №${table.number}`, before: { capacity: table.capacity }, after: { capacity: input.capacity }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return getTournamentSeating(input.tournamentId);
}

export async function closeTournamentTable(input: { tournamentId: string; tableId: string; actorId: string }) {
  await serializable(() => prisma.$transaction(async (tx) => {
    const table = await tx.tournamentTable.findFirst({
      where: { id: input.tableId, tournamentId: input.tournamentId },
      include: { tournament: true, seats: { select: { userId: true, seatNumber: true } } }
    });
    if (!table) throw new AppError('Стол не найден', 404, 'TABLE_NOT_FOUND');
    if (isLockedStatus(table.tournament.status)) throw new AppError('Нельзя менять столы завершённого или отменённого турнира', 409, 'SEATING_LOCKED');
    await tx.tournamentTable.delete({ where: { id: table.id } });
    await tx.tournament.update({ where: { id: table.tournamentId }, data: { seatingPublishedAt: null, seatingVersion: { increment: 1 } } });
    await writeAudit(tx, {
      actorId: input.actorId, action: 'TOURNAMENT_TABLE_CLOSED', entityType: 'TournamentSeating', entityId: table.tournamentId,
      summary: `Закрыт стол №${table.number} в «${table.tournament.title}»`,
      before: { tableId: table.id, number: table.number, capacity: table.capacity, seats: table.seats },
      after: { returnedToUnseated: table.seats.length }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return getTournamentSeating(input.tournamentId);
}
