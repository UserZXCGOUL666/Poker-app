import { Prisma, TournamentRegistrationStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';
import { evaluateAchievements, qualifyReferralInTransaction } from './loyalty.js';

const occupiedStatuses: TournamentRegistrationStatus[] = [
  TournamentRegistrationStatus.REGISTERED,
  TournamentRegistrationStatus.CHECKED_IN,
  TournamentRegistrationStatus.PLAYED
];
const attendedStatuses: TournamentRegistrationStatus[] = [
  TournamentRegistrationStatus.CHECKED_IN,
  TournamentRegistrationStatus.PLAYED
];

type RegistrationActor = { actorId: string; actorIsAdmin: boolean };

export async function registerForTournament(tournamentId: string, userId: string, actor: RegistrationActor) {
  return withRegistrationRetry(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
    const now = new Date();
    if (!canRegisterForTournamentStatus(tournament.status)) throw new AppError('Регистрация на этот турнир недоступна', 409, 'REGISTRATION_UNAVAILABLE');
    if (tournament.registrationClosed) throw new AppError('Администратор закрыл регистрацию', 409, 'REGISTRATION_CLOSED');
    if (tournament.registrationDeadline && tournament.registrationDeadline <= now) throw new AppError('Срок регистрации завершён', 409, 'REGISTRATION_DEADLINE');
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } });
    if (!user) throw new AppError('Пользователь не найден', 404, 'USER_NOT_FOUND');

    const existing = await tx.tournamentRegistration.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } });
    if (existing && existing.status !== TournamentRegistrationStatus.CANCELLED) {
      return { registration: existing, tournament, user, duplicate: true, promoted: null };
    }

    const occupied = await tx.tournamentRegistration.count({ where: { tournamentId, status: { in: occupiedStatuses } } });
    const status = nextRegistrationStatus(occupied, tournament.capacity);
    const registration = existing
      ? await tx.tournamentRegistration.update({
        where: { id: existing.id },
        data: { status, cancelledAt: null, checkedInAt: null, promotedAt: status === 'REGISTERED' ? now : null }
      })
      : await tx.tournamentRegistration.create({ data: { tournamentId, userId, status } });
    await syncParticipantCount(tx, tournamentId);
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: status === 'REGISTERED' ? 'REGISTRATION_CREATED' : 'WAITLIST_JOINED',
      entityType: 'TournamentRegistration',
      entityId: registration.id,
      summary: `${user.firstName} ${status === 'REGISTERED' ? 'записан на турнир' : 'добавлен в лист ожидания'}`,
      after: { tournamentId, userId, status },
      metadata: { actorIsAdmin: actor.actorIsAdmin }
    });
    return { registration, tournament, user, duplicate: false, promoted: null };
  });
}

export async function cancelTournamentRegistration(registrationId: string, actor: RegistrationActor & { requestedByUserId?: string }) {
  return withRegistrationRetry(async (tx) => {
    const registration = await tx.tournamentRegistration.findUnique({
      where: { id: registrationId },
      include: { tournament: true, user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } } }
    });
    if (!registration) throw new AppError('Регистрация не найдена', 404, 'REGISTRATION_NOT_FOUND');
    if (attendedStatuses.includes(registration.status)) {
      throw new AppError('Чек-ин уже подтверждён и не может быть отменён', 409, 'CHECK_IN_IRREVERSIBLE');
    }
    if (!actor.actorIsAdmin && registration.userId !== actor.requestedByUserId) throw new AppError('Нельзя изменить чужую регистрацию', 403, 'FORBIDDEN');
    if (!actor.actorIsAdmin && !canPlayerCancelRegistration(registration.tournament.status, registration.status)) {
      throw new AppError('Самостоятельная отмена доступна только до начала турнира', 409, 'CANCELLATION_UNAVAILABLE');
    }
    if (registration.status === TournamentRegistrationStatus.CANCELLED) {
      return { registration, user: registration.user, promoted: null, tournament: registration.tournament, duplicate: true };
    }
    const occupiedBefore = occupiedStatuses.includes(registration.status);
    const cancelled = await tx.tournamentRegistration.update({
      where: { id: registration.id },
      data: { status: TournamentRegistrationStatus.CANCELLED, cancelledAt: new Date(), checkedInAt: null }
    });
    const promoted = occupiedBefore ? await promoteFirstWaitlisted(tx, registration.tournamentId, registration.id) : null;
    await syncParticipantCount(tx, registration.tournamentId);
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'REGISTRATION_CANCELLED',
      entityType: 'TournamentRegistration',
      entityId: registration.id,
      summary: `Отменена запись: ${registration.user.firstName}`,
      before: { status: registration.status },
      after: { status: TournamentRegistrationStatus.CANCELLED },
      metadata: { tournamentId: registration.tournamentId, promotedUserId: promoted?.userId ?? null }
    });
    return { registration: cancelled, user: registration.user, promoted, tournament: registration.tournament, duplicate: false };
  });
}

export async function updateRegistrationStatus(registrationId: string, status: TournamentRegistrationStatus, actorId: string) {
  if (status === TournamentRegistrationStatus.CANCELLED) {
    return cancelTournamentRegistration(registrationId, { actorId, actorIsAdmin: true });
  }
  const result = await withRegistrationRetry(async (tx) => {
    const current = await tx.tournamentRegistration.findUnique({
      where: { id: registrationId },
      include: { tournament: true, user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } } }
    });
    if (!current) throw new AppError('Регистрация не найдена', 404, 'REGISTRATION_NOT_FOUND');
    if (current.status === status) return { registration: current, user: current.user, promoted: null, tournament: current.tournament, duplicate: true, previousStatus: current.status };
    if (!canTransitionRegistrationStatus(current.status, status)) {
      throw new AppError('Чек-ин уже подтверждён и не может быть отменён', 409, 'CHECK_IN_IRREVERSIBLE');
    }

    if (occupiedStatuses.includes(status) && !occupiedStatuses.includes(current.status)) {
      const occupied = await tx.tournamentRegistration.count({ where: { tournamentId: current.tournamentId, status: { in: occupiedStatuses } } });
      if (occupied >= current.tournament.capacity) throw new AppError('Основной список заполнен', 409, 'TOURNAMENT_FULL');
    }
    const opensSeat = occupiedStatuses.includes(current.status) && !occupiedStatuses.includes(status);
    const now = new Date();
    const registration = await tx.tournamentRegistration.update({
      where: { id: current.id },
      data: {
        status,
        promotedAt: status === TournamentRegistrationStatus.REGISTERED && current.status === TournamentRegistrationStatus.WAITLISTED ? now : current.promotedAt,
        checkedInAt: attendedStatuses.includes(status) ? current.checkedInAt ?? now : current.checkedInAt,
        cancelledAt: null
      }
    });
    const promoted = opensSeat ? await promoteFirstWaitlisted(tx, current.tournamentId, current.id) : null;
    await syncParticipantCount(tx, current.tournamentId);
    await writeAudit(tx, {
      actorId,
      action: 'REGISTRATION_STATUS_CHANGED',
      entityType: 'TournamentRegistration',
      entityId: current.id,
      summary: `Статус участника ${current.user.firstName}: ${current.status} → ${status}`,
      before: { status: current.status },
      after: { status },
      metadata: { tournamentId: current.tournamentId, userId: current.userId }
    });
    if (attendedStatuses.includes(status) && !attendedStatuses.includes(current.status)) {
      await qualifyReferralInTransaction(tx, current.userId, actorId);
    }
    return { registration, user: current.user, promoted, tournament: current.tournament, duplicate: false, previousStatus: current.status };
  });
  if (attendedStatuses.includes(status) && !result.duplicate) {
    await evaluateAchievements(result.user.id).catch((error) => console.error('Не удалось проверить достижения', error));
  }
  return result;
}

async function promoteFirstWaitlisted(tx: Prisma.TransactionClient, tournamentId: string, excludeId?: string) {
  const next = await tx.tournamentRegistration.findFirst({
    where: { tournamentId, status: TournamentRegistrationStatus.WAITLISTED, id: excludeId ? { not: excludeId } : undefined },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } } }
  });
  if (!next) return null;
  const promotedAt = new Date();
  const registration = await tx.tournamentRegistration.update({
    where: { id: next.id },
    data: { status: TournamentRegistrationStatus.REGISTERED, promotedAt, cancelledAt: null }
  });
  await writeAudit(tx, {
    actorId: null,
    action: 'WAITLIST_PROMOTED',
    entityType: 'TournamentRegistration',
    entityId: next.id,
    summary: `${next.user.firstName} автоматически переведён из листа ожидания`,
    before: { status: TournamentRegistrationStatus.WAITLISTED },
    after: { status: TournamentRegistrationStatus.REGISTERED },
    metadata: { tournamentId, userId: next.userId }
  });
  return { ...registration, user: next.user };
}

async function syncParticipantCount(tx: Prisma.TransactionClient, tournamentId: string) {
  const participantCount = await tx.tournamentRegistration.count({ where: { tournamentId, status: { in: occupiedStatuses } } });
  await tx.tournament.update({ where: { id: tournamentId }, data: { participantCount } });
  return participantCount;
}

async function withRegistrationRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code);
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new AppError('Не удалось обновить регистрацию. Повторите попытку.', 409, 'REGISTRATION_CONFLICT');
}

export function isOccupiedRegistration(status: TournamentRegistrationStatus) {
  return occupiedStatuses.includes(status);
}

export function nextRegistrationStatus(occupied: number, capacity: number) {
  return occupied < capacity ? TournamentRegistrationStatus.REGISTERED : TournamentRegistrationStatus.WAITLISTED;
}

export function canPlayerCancelRegistration(tournamentStatus: string, registrationStatus: TournamentRegistrationStatus) {
  return tournamentStatus === 'UPCOMING' && (
    registrationStatus === TournamentRegistrationStatus.REGISTERED || registrationStatus === TournamentRegistrationStatus.WAITLISTED
  );
}

export function canRegisterForTournamentStatus(tournamentStatus: string) {
  return tournamentStatus === 'UPCOMING' || tournamentStatus === 'ACTIVE';
}

export function canTransitionRegistrationStatus(current: TournamentRegistrationStatus, next: TournamentRegistrationStatus) {
  if (current === TournamentRegistrationStatus.PLAYED) return false;
  if (current === TournamentRegistrationStatus.CHECKED_IN) return next === TournamentRegistrationStatus.PLAYED;
  return true;
}

export function shouldNotifyRegistrationStatusChange(previousStatus: TournamentRegistrationStatus | undefined, status: TournamentRegistrationStatus) {
  return status === TournamentRegistrationStatus.CANCELLED || status === TournamentRegistrationStatus.WAITLISTED || (
    status === TournamentRegistrationStatus.REGISTERED && previousStatus === TournamentRegistrationStatus.WAITLISTED
  );
}
