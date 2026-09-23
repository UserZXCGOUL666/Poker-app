import {
  Prisma,
  TournamentStatus,
  TournamentTimerLevelKind,
  TournamentTimerStatus,
  type TournamentTimer,
  type TournamentTimerLevel
} from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { writeAudit } from './audit.js';

export type TimerWithLevels = TournamentTimer & {
  levels: TournamentTimerLevel[];
  tournament: { id: string; title: string; status: TournamentStatus };
};

export type ResolvedTimerClock = {
  status: TournamentTimerStatus;
  currentLevelIndex: number;
  remainingSeconds: number;
};

export const DEFAULT_TIMER_LEVELS = [
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 25, bigBlind: 50, ante: 0, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 50, bigBlind: 100, ante: 0, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 75, bigBlind: 150, ante: 0, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 100, bigBlind: 200, ante: 0, label: null },
  { kind: TournamentTimerLevelKind.BREAK, durationSeconds: 10 * 60, smallBlind: null, bigBlind: null, ante: null, label: 'Перерыв' },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 150, bigBlind: 300, ante: 25, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 200, bigBlind: 400, ante: 50, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 300, bigBlind: 600, ante: 75, label: null },
  { kind: TournamentTimerLevelKind.BREAK, durationSeconds: 10 * 60, smallBlind: null, bigBlind: null, ante: null, label: 'Перерыв' },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 400, bigBlind: 800, ante: 100, label: null },
  { kind: TournamentTimerLevelKind.LEVEL, durationSeconds: 15 * 60, smallBlind: 500, bigBlind: 1000, ante: 100, label: null }
] as const;

const includeTimer = {
  levels: { orderBy: { position: 'asc' as const } },
  tournament: { select: { id: true, title: true, status: true } }
} satisfies Prisma.TournamentTimerInclude;

export function resolveTimerClock(
  timer: Pick<TournamentTimer, 'status' | 'currentLevelIndex' | 'remainingSeconds' | 'startedAt'> & {
    levels: Pick<TournamentTimerLevel, 'durationSeconds'>[];
  },
  now = new Date()
): ResolvedTimerClock {
  if (!timer.levels.length) {
    return { status: TournamentTimerStatus.READY, currentLevelIndex: 0, remainingSeconds: 0 };
  }
  let status = timer.status;
  let currentLevelIndex = Math.min(Math.max(0, timer.currentLevelIndex), timer.levels.length - 1);
  let remainingSeconds = Math.max(0, timer.remainingSeconds);
  if (status !== TournamentTimerStatus.RUNNING || !timer.startedAt) {
    return { status, currentLevelIndex, remainingSeconds };
  }

  let elapsedSeconds = Math.max(0, Math.floor((now.getTime() - timer.startedAt.getTime()) / 1000));
  remainingSeconds -= elapsedSeconds;
  while (remainingSeconds <= 0 && currentLevelIndex < timer.levels.length - 1) {
    const overflow = Math.max(0, -remainingSeconds);
    currentLevelIndex += 1;
    remainingSeconds = timer.levels[currentLevelIndex].durationSeconds - overflow;
  }
  if (remainingSeconds <= 0 && currentLevelIndex === timer.levels.length - 1) {
    status = TournamentTimerStatus.FINISHED;
    remainingSeconds = 0;
  }
  return { status, currentLevelIndex, remainingSeconds: Math.max(0, remainingSeconds) };
}

export function serializeTimer(timer: TimerWithLevels, now = new Date()) {
  const clock = resolveTimerClock(timer, now);
  return {
    id: timer.id,
    tournamentId: timer.tournamentId,
    tournament: timer.tournament,
    status: clock.status,
    currentLevelIndex: clock.currentLevelIndex,
    remainingSeconds: clock.remainingSeconds,
    serverNow: now.toISOString(),
    updatedAt: timer.updatedAt,
    levels: timer.levels
  };
}

export async function findTournamentTimer(tournamentId: string) {
  return prisma.tournamentTimer.findUnique({ where: { tournamentId }, include: includeTimer });
}

export async function getOrCreateTournamentTimer(tournamentId: string, actorId: string) {
  const existing = await findTournamentTimer(tournamentId);
  if (existing) return existing;
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, title: true } });
  if (!tournament) throw new AppError('Турнир не найден', 404, 'TOURNAMENT_NOT_FOUND');
  return prisma.$transaction(async (tx) => {
    const timer = await tx.tournamentTimer.create({
      data: {
        tournamentId,
        remainingSeconds: DEFAULT_TIMER_LEVELS[0].durationSeconds,
        levels: {
          create: DEFAULT_TIMER_LEVELS.map((level, position) => ({ ...level, position }))
        }
      },
      include: includeTimer
    });
    await writeAudit(tx, {
      actorId,
      action: 'TOURNAMENT_TIMER_CREATED',
      entityType: 'TournamentTimer',
      entityId: timer.id,
      summary: `Создан таймер турнира «${tournament.title}»`,
      after: { levels: timer.levels.length }
    });
    return timer;
  });
}

type TimerLevelInput = {
  kind: TournamentTimerLevelKind;
  durationSeconds: number;
  smallBlind?: number | null;
  bigBlind?: number | null;
  ante?: number | null;
  label?: string | null;
};

export async function replaceTournamentTimerLevels(tournamentId: string, levels: TimerLevelInput[], actorId: string) {
  return prisma.$transaction(async (tx) => {
    const timer = await tx.tournamentTimer.findUnique({ where: { tournamentId }, include: includeTimer });
    if (!timer) throw new AppError('Сначала откройте таймер турнира', 404, 'TIMER_NOT_FOUND');
    const now = new Date();
    const clock = resolveTimerClock(timer, now);
    const currentLevelIndex = Math.min(clock.currentLevelIndex, levels.length - 1);
    const remainingSeconds = Math.max(1, Math.min(clock.remainingSeconds, levels[currentLevelIndex].durationSeconds));
    await tx.tournamentTimerLevel.deleteMany({ where: { timerId: timer.id } });
    await tx.tournamentTimerLevel.createMany({
      data: levels.map((level, position) => ({
        timerId: timer.id,
        position,
        kind: level.kind,
        durationSeconds: level.durationSeconds,
        smallBlind: level.kind === TournamentTimerLevelKind.LEVEL ? level.smallBlind ?? 0 : null,
        bigBlind: level.kind === TournamentTimerLevelKind.LEVEL ? level.bigBlind ?? 0 : null,
        ante: level.kind === TournamentTimerLevelKind.LEVEL ? level.ante ?? 0 : null,
        label: level.label?.trim() || null
      }))
    });
    await tx.tournamentTimer.update({
      where: { id: timer.id },
      data: {
        currentLevelIndex,
        remainingSeconds,
        status: clock.status,
        startedAt: clock.status === TournamentTimerStatus.RUNNING ? now : null
      }
    });
    await writeAudit(tx, {
      actorId,
      action: 'TOURNAMENT_TIMER_STRUCTURE_UPDATED',
      entityType: 'TournamentTimer',
      entityId: timer.id,
      summary: `Обновлена структура таймера «${timer.tournament.title}»`,
      before: { levels: timer.levels.length },
      after: { levels: levels.length, totalSeconds: levels.reduce((sum, level) => sum + level.durationSeconds, 0) }
    });
    return tx.tournamentTimer.findUniqueOrThrow({ where: { id: timer.id }, include: includeTimer });
  });
}

export type TournamentTimerAction =
  | { action: 'START' | 'PAUSE' | 'RESUME' | 'NEXT' | 'PREVIOUS' | 'RESET' | 'FINISH' }
  | { action: 'GOTO'; levelIndex: number }
  | { action: 'ADD_TIME'; seconds: number }
  | { action: 'SET_REMAINING'; seconds: number };

export async function applyTournamentTimerAction(tournamentId: string, input: TournamentTimerAction, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const timer = await tx.tournamentTimer.findUnique({ where: { tournamentId }, include: includeTimer });
    if (!timer) throw new AppError('Таймер турнира не настроен', 404, 'TIMER_NOT_FOUND');
    if (!timer.levels.length) throw new AppError('В таймере нет уровней', 409, 'TIMER_HAS_NO_LEVELS');
    const now = new Date();
    const clock = resolveTimerClock(timer, now);
    let status = clock.status;
    let currentLevelIndex = clock.currentLevelIndex;
    let remainingSeconds = clock.remainingSeconds;

    switch (input.action) {
      case 'START':
      case 'RESUME':
        if (timer.tournament.status === TournamentStatus.CANCELLED || timer.tournament.status === TournamentStatus.FINISHED) {
          throw new AppError('Нельзя запустить таймер отменённого или завершённого турнира', 409, 'TOURNAMENT_TIMER_LOCKED');
        }
        if (status === TournamentTimerStatus.FINISHED) {
          currentLevelIndex = 0;
          remainingSeconds = timer.levels[0].durationSeconds;
        }
        status = TournamentTimerStatus.RUNNING;
        break;
      case 'PAUSE':
        status = TournamentTimerStatus.PAUSED;
        break;
      case 'NEXT':
        if (currentLevelIndex >= timer.levels.length - 1) {
          status = TournamentTimerStatus.FINISHED;
          remainingSeconds = 0;
        } else {
          currentLevelIndex += 1;
          remainingSeconds = timer.levels[currentLevelIndex].durationSeconds;
        }
        break;
      case 'PREVIOUS':
        currentLevelIndex = Math.max(0, currentLevelIndex - 1);
        remainingSeconds = timer.levels[currentLevelIndex].durationSeconds;
        if (status === TournamentTimerStatus.FINISHED) status = TournamentTimerStatus.PAUSED;
        break;
      case 'RESET':
        status = TournamentTimerStatus.READY;
        currentLevelIndex = 0;
        remainingSeconds = timer.levels[0].durationSeconds;
        break;
      case 'FINISH':
        status = TournamentTimerStatus.FINISHED;
        remainingSeconds = 0;
        break;
      case 'GOTO':
        currentLevelIndex = Math.min(Math.max(0, input.levelIndex), timer.levels.length - 1);
        remainingSeconds = timer.levels[currentLevelIndex].durationSeconds;
        if (status === TournamentTimerStatus.FINISHED) status = TournamentTimerStatus.PAUSED;
        break;
      case 'ADD_TIME':
        remainingSeconds = Math.min(6 * 60 * 60, Math.max(1, remainingSeconds + input.seconds));
        if (status === TournamentTimerStatus.FINISHED) status = TournamentTimerStatus.PAUSED;
        break;
      case 'SET_REMAINING':
        remainingSeconds = input.seconds;
        if (status === TournamentTimerStatus.FINISHED) status = TournamentTimerStatus.PAUSED;
        break;
    }

    const updated = await tx.tournamentTimer.update({
      where: { id: timer.id },
      data: {
        status,
        currentLevelIndex,
        remainingSeconds,
        startedAt: status === TournamentTimerStatus.RUNNING ? now : null
      },
      include: includeTimer
    });
    if ((input.action === 'START' || input.action === 'RESUME') && timer.tournament.status === TournamentStatus.UPCOMING) {
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: TournamentStatus.ACTIVE } });
      updated.tournament.status = TournamentStatus.ACTIVE;
    }
    await writeAudit(tx, {
      actorId,
      action: `TOURNAMENT_TIMER_${input.action}`,
      entityType: 'TournamentTimer',
      entityId: timer.id,
      summary: `Таймер «${timer.tournament.title}»: ${timerActionLabel(input.action)}`,
      before: { status: clock.status, currentLevelIndex: clock.currentLevelIndex, remainingSeconds: clock.remainingSeconds },
      after: { status, currentLevelIndex, remainingSeconds },
      metadata: input as unknown as Prisma.InputJsonValue
    });
    return updated;
  });
}

function timerActionLabel(action: TournamentTimerAction['action']) {
  const labels: Record<TournamentTimerAction['action'], string> = {
    START: 'запущен',
    PAUSE: 'поставлен на паузу',
    RESUME: 'продолжен',
    NEXT: 'следующий уровень',
    PREVIOUS: 'предыдущий уровень',
    RESET: 'сброшен',
    FINISH: 'завершён',
    GOTO: 'изменён текущий уровень',
    ADD_TIME: 'изменено оставшееся время',
    SET_REMAINING: 'установлено оставшееся время'
  };
  return labels[action];
}
